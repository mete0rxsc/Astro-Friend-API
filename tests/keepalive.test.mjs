import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler, { KEEPALIVE_KEY, KEEPALIVE_TTL_SECONDS } from "../api/keepalive.mjs";

const response = () => ({
	headers: {},
	statusCode: 200,
	body: null,
	setHeader(name, value) { this.headers[name] = value; },
	status(code) { this.statusCode = code; return this; },
	json(body) { this.body = body; return this; },
});
const request = (method = "GET") => ({ method, headers: {} });
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
	process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.com/";
	process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";
});

afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const key of Object.keys(process.env)) {
		if (!(key in originalEnv)) delete process.env[key];
	}
	Object.assign(process.env, originalEnv);
});

test("rejects non-GET requests", async () => {
	const res = response();
	await handler(request("POST"), res);
	assert.equal(res.statusCode, 405);
	assert.equal(res.body.code, "METHOD_NOT_ALLOWED");
	assert.equal(res.headers["Cache-Control"], "no-store");
});

test("fails closed when Upstash configuration is missing", async () => {
	delete process.env.UPSTASH_REDIS_REST_URL;
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 503);
	assert.equal(res.body.code, "UPSTASH_CONFIG");
});

test("writes a dedicated keepalive key with a 30-day TTL", async () => {
	let call;
	globalThis.fetch = async (url, options) => {
		call = { url: String(url), options };
		return new Response(JSON.stringify([{ result: "OK" }]), { status: 200 });
	};
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, { ok: true, service: "friend-apply", redis: "alive" });
	assert.equal(call.url, "https://upstash.example.com/pipeline");
	assert.equal(call.options.method, "POST");
	const commands = JSON.parse(call.options.body);
	assert.equal(commands.length, 1);
	assert.equal(commands[0][0], "SET");
	assert.equal(commands[0][1], KEEPALIVE_KEY);
	assert.equal(commands[0][3], "EX");
	assert.equal(commands[0][4], KEEPALIVE_TTL_SECONDS);
	assert.match(commands[0][2], /^\d{4}-\d{2}-\d{2}T/);
	assert.equal(commands[0][1].startsWith("friend-apply:"), true);
	assert.equal(res.headers["Cache-Control"], "no-store");
});

test("converts Upstash failures to a stable 502 response", async () => {
	globalThis.fetch = async () => new Response("failed", { status: 500 });
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 502);
	assert.equal(res.body.code, "UPSTASH_ERROR");
});

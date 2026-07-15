import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/friend-apply.mjs";
import { buildIssue, extractIssueUrl, validateApplication } from "../lib/friend-apply.mjs";

const payload = {
	title: "Example Blog", url: "https://example.com/", icon: "https://example.com/icon.png", snapshot: "",
	description: "An example blog.", feed: "", friendsPage: "https://example.com/links/", friendsRepo: "",
	legalCommitment: true, crawlCommitment: true, originalContent: true, independentDomain: true,
	threeYears: false, priorInteraction: false, website: "", turnstileToken: "turnstile-token",
};
const response = () => ({ headers: {}, statusCode: 200, body: null,
	setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; },
	json(body) { this.body = body; return this; }, end() { return this; } });
const request = (body = payload, overrides = {}) => ({ method: "POST", headers: { origin: "https://www.xscnet.cn", "x-forwarded-for": "203.0.113.1", ...(overrides.headers || {}) }, body: JSON.stringify(body), ...overrides });
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };

beforeEach(() => {
	process.env.ALLOWED_ORIGINS = "https://xscnet.cn,https://www.xscnet.cn";
	process.env.GITHUB_TOKEN = "test-token";
	process.env.TURNSTILE_SECRET_KEY = "turnstile-secret";
	process.env.UPSTASH_REDIS_REST_URL = "https://upstash.example.com";
	process.env.UPSTASH_REDIS_REST_TOKEN = "upstash-token";
});
afterEach(() => {
	globalThis.fetch = originalFetch;
	for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key];
	Object.assign(process.env, originalEnv);
});

test("Issue body remains compatible with the repository template", () => {
	const issue = buildIssue(validateApplication(payload, { validation: {} }));
	assert.equal(issue.title, "[友链申请] Example Blog");
	assert.match(issue.body, /### 检查清单/);
	assert.match(issue.body, /### 友链仓库（可选）\n未提供/);
	assert.equal(extractIssueUrl(issue.body), "https://example.com");
});

test("validation rejects illegal URLs and missing commitments", () => {
	assert.throws(() => validateApplication({ ...payload, url: "http://example.com" }, {}));
	assert.throws(() => validateApplication({ ...payload, legalCommitment: false }, {}));
});

test("allowed CORS preflight succeeds", async () => {
	const res = response();
	await handler(request(payload, { method: "OPTIONS" }), res);
	assert.equal(res.statusCode, 204);
	assert.equal(res.headers["Access-Control-Allow-Origin"], "https://www.xscnet.cn");
});

test("successful request creates an audited Issue", { concurrency: false }, async () => {
	const calls = [];
	globalThis.fetch = async (url, options = {}) => {
		calls.push({ url: String(url), options });
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true }), { status: 200 });
		if (String(url).includes("/issues?")) return new Response("[]", { status: 200 });
		return new Response(JSON.stringify({ html_url: "https://github.com/mete0rxsc/HexoBlogFriends/issues/1" }), { status: 201 });
	};
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 201);
	assert.equal(res.body.code, "CREATED");
	const create = calls.find((call) => call.url.endsWith("/issues"));
	assert.deepEqual(JSON.parse(create.options.body).labels, ["审核中"]);
});

test("Turnstile failure is rejected", { concurrency: false }, async () => {
	globalThis.fetch = async (url) => String(url).includes("upstash")
		? new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 })
		: new Response(JSON.stringify({ success: false }), { status: 200 });
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 400);
	assert.equal(res.body.code, "TURNSTILE_FAILED");
});

test("unknown origin is rejected before external calls", { concurrency: false }, async () => {
	globalThis.fetch = async () => { throw new Error("must not fetch"); };
	const res = response();
	await handler(request(payload, { headers: { origin: "https://attacker.example" } }), res);
	assert.equal(res.statusCode, 403);
	assert.equal(res.body.code, "ORIGIN_FORBIDDEN");
});

test("rate limit returns Retry-After", { concurrency: false }, async () => {
	globalThis.fetch = async () => new Response(JSON.stringify([{ result: 4 }, { result: 1 }]), { status: 200 });
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 429);
	assert.equal(res.headers["Retry-After"], "3600");
});

test("duplicate URL and GitHub errors use stable codes", { concurrency: false }, async () => {
	const existing = buildIssue(validateApplication(payload, {}));
	globalThis.fetch = async (url) => {
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true }), { status: 200 });
		return new Response(JSON.stringify([{ body: existing.body }]), { status: 200 });
	};
	const duplicate = response();
	await handler(request(), duplicate);
	assert.equal(duplicate.statusCode, 409);
	assert.equal(duplicate.body.code, "DUPLICATE_URL");

	globalThis.fetch = async (url) => {
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true }), { status: 200 });
		if (String(url).includes("/issues?")) return new Response("[]", { status: 200 });
		return new Response("failed", { status: 500 });
	};
	const failed = response();
	await handler(request(), failed);
	assert.equal(failed.statusCode, 502);
	assert.equal(failed.body.code, "GITHUB_ERROR");
});

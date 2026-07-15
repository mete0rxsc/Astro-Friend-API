import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler from "../api/friend-apply.mjs";
import healthHandler from "../api/health.mjs";
import config from "../config.mjs";
import { buildIssue, extractIssueUrl, validateApplication } from "../lib/friend-apply.mjs";

const validPayload = {
	title: "Example Blog",
	url: "https://example.com/",
	icon: "https://example.com/icon.png",
	snapshot: "https://example.com/snapshot.png",
	description: "An example blog.",
	feed: "https://example.com/feed.xml",
	friendsPage: "https://example.com/links/",
	friendsRepo: "https://github.com/example/friends",
	legalCommitment: true,
	crawlCommitment: true,
	originalContent: true,
	independentDomain: true,
	threeYears: false,
	priorInteraction: false,
	website: "",
	turnstileToken: "turnstile-token",
};

const response = () => ({
	headers: {},
	statusCode: 200,
	body: null,
	ended: false,
	setHeader(name, value) { this.headers[name] = value; },
	status(code) { this.statusCode = code; return this; },
	json(body) { this.body = body; return this; },
	end() { this.ended = true; return this; },
});

const request = (body = validPayload, overrides = {}) => ({
	method: "POST",
	headers: { origin: "https://xscnet.cn", "x-forwarded-for": "203.0.113.1", ...(overrides.headers || {}) },
	body: JSON.stringify(body),
	...overrides,
});

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

test("configuration targets the audited friend repository", () => {
	assert.equal(config.repository.owner, "mete0rxsc");
	assert.equal(config.repository.name, "HexoBlogFriends");
	assert.equal(config.repository.pendingLabel, "审核中");
	assert.equal(config.rateLimit.requests, 3);
	assert.equal(config.rateLimit.windowSeconds, 3600);
});

test("validation and Issue body match the repository template", () => {
	const application = validateApplication(validPayload, config);
	const issue = buildIssue(application);
	assert.equal(issue.title, "[友链申请] Example Blog");
	assert.match(issue.body, /### 检查清单/);
	assert.match(issue.body, /```json/);
	assert.match(issue.body, /### 友链地址/);
	assert.equal(extractIssueUrl(issue.body), "https://example.com");
});

test("validation rejects HTTP URLs, honeypots and missing commitments", () => {
	assert.throws(() => validateApplication({ ...validPayload, url: "http://example.com" }, config));
	assert.throws(() => validateApplication({ ...validPayload, website: "spam" }, config));
	assert.throws(() => validateApplication({ ...validPayload, legalCommitment: false }, config));
});

test("handler answers an allowed CORS preflight", async () => {
	const res = response();
	await handler(request(undefined, { method: "OPTIONS", body: undefined }), res);
	assert.equal(res.statusCode, 204);
	assert.equal(res.ended, true);
	assert.equal(res.headers["Access-Control-Allow-Origin"], "https://xscnet.cn");
	assert.equal(res.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
});

test("handler creates an audited GitHub Issue", { concurrency: false }, async () => {
	const calls = [];
	globalThis.fetch = async (url, options = {}) => {
		calls.push({ url: String(url), options });
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true }), { status: 200 });
		if (String(url).includes("/issues?")) return new Response(JSON.stringify([]), { status: 200 });
		if (String(url).endsWith("/issues")) return new Response(JSON.stringify({ html_url: "https://github.com/mete0rxsc/HexoBlogFriends/issues/1" }), { status: 201 });
		throw new Error(`Unexpected fetch ${url}`);
	};
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 201);
	assert.equal(res.body.code, "CREATED");
	assert.equal(res.body.issueUrl, "https://github.com/mete0rxsc/HexoBlogFriends/issues/1");
	const create = calls.find((call) => call.url.endsWith("/issues"));
	const body = JSON.parse(create.options.body);
	assert.deepEqual(body.labels, ["审核中"]);
	assert.match(body.body, /"url": "https:\/\/example.com\/"/);
});

test("handler rejects Turnstile failures", { concurrency: false }, async () => {
	globalThis.fetch = async (url) => {
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: false }), { status: 200 });
		throw new Error("GitHub must not be called");
	};
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 400);
	assert.equal(res.body.code, "TURNSTILE_FAILED");
});

test("handler rejects origins outside the deployment allowlist", { concurrency: false }, async () => {
	globalThis.fetch = async () => { throw new Error("External services must not be called"); };
	const res = response();
	await handler(request(validPayload, { headers: { origin: "https://attacker.example" } }), res);
	assert.equal(res.statusCode, 403);
	assert.equal(res.body.code, "ORIGIN_FORBIDDEN");
	assert.equal(res.headers["Access-Control-Allow-Origin"], undefined);
});

test("handler returns Retry-After when Upstash denies the source", { concurrency: false }, async () => {
	globalThis.fetch = async () => new Response(JSON.stringify([{ result: 4 }, { result: 1 }]), { status: 200 });
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 429);
	assert.equal(res.body.code, "RATE_LIMITED");
	assert.equal(res.headers["Retry-After"], "3600");
});

test("handler fails closed when Upstash is not configured", { concurrency: false }, async () => {
	delete process.env.UPSTASH_REDIS_REST_URL;
	delete process.env.UPSTASH_REDIS_REST_TOKEN;
	globalThis.fetch = async () => { throw new Error("External services must not be called"); };
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 503);
	assert.equal(res.body.code, "CONFIG_ERROR");
});

test("handler detects an existing application URL", { concurrency: false }, async () => {
	const existing = buildIssue(validateApplication(validPayload, config));
	globalThis.fetch = async (url) => {
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true }), { status: 200 });
		if (String(url).includes("/issues?")) return new Response(JSON.stringify([{ body: existing.body }]), { status: 200 });
		throw new Error("Issue creation must not be called");
	};
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 409);
	assert.equal(res.body.code, "DUPLICATE_URL");
});

test("handler maps GitHub creation failures to a stable error", { concurrency: false }, async () => {
	globalThis.fetch = async (url) => {
		if (String(url).includes("upstash")) return new Response(JSON.stringify([{ result: 1 }, { result: 1 }]), { status: 200 });
		if (String(url).includes("siteverify")) return new Response(JSON.stringify({ success: true }), { status: 200 });
		if (String(url).includes("/issues?")) return new Response(JSON.stringify([]), { status: 200 });
		return new Response(JSON.stringify({ message: "failed" }), { status: 500 });
	};
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 502);
	assert.equal(res.body.code, "GITHUB_ERROR");
});

test("health endpoint exposes no configuration details", () => {
	const res = response();
	healthHandler({ method: "GET" }, res);
	assert.equal(res.statusCode, 200);
	assert.deepEqual(res.body, { ok: true, service: "friend-apply" });
	assert.doesNotMatch(JSON.stringify(res.body), /token|secret|repository/i);
});

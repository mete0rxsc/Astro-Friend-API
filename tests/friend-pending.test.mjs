import test, { afterEach, beforeEach } from "node:test";
import assert from "node:assert/strict";
import handler, { normalizePendingIssues } from "../api/friend-pending.mjs";

const response = () => ({ headers: {}, statusCode: 200, body: null, setHeader(name, value) { this.headers[name] = value; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end() { return this; } });
const request = (method = "GET", origin = "https://www.xscnet.cn") => ({ method, headers: { origin } });
const originalFetch = globalThis.fetch;
const originalEnv = { ...process.env };
beforeEach(() => { process.env.ALLOWED_ORIGINS = "https://xscnet.cn,https://www.xscnet.cn"; process.env.GITHUB_TOKEN = "test-token"; });
afterEach(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in originalEnv)) delete process.env[key]; Object.assign(process.env, originalEnv); });

test("normalizer filters labels, closed Issues and pull requests", () => {
	const items = normalizePendingIssues([
		{ number: 2, title: "[友链申请] Example", created_at: "2026-07-15T10:00:00Z", state: "open", labels: [{ name: "审核中" }] },
		{ number: 1, title: "Closed", created_at: "2026-07-14T10:00:00Z", state: "closed", labels: [{ name: "审核中" }] },
	]);
	assert.deepEqual(items[0], { number: 2, title: "Example", createdAt: "2026-07-15T10:00:00.000Z", issueUrl: "https://github.com/mete0rxsc/HexoBlogFriends/issues/2" });
});

test("pending CORS and origin protection work", async () => {
	const preflight = response();
	await handler(request("OPTIONS"), preflight);
	assert.equal(preflight.statusCode, 204);
	assert.equal(preflight.headers["Access-Control-Allow-Origin"], "https://www.xscnet.cn");
	const blocked = response();
	await handler(request("GET", "https://attacker.example"), blocked);
	assert.equal(blocked.statusCode, 403);
});

test("pending endpoint returns sanitized fields and CDN caching", async () => {
	globalThis.fetch = async () => new Response(JSON.stringify([{ number: 9, title: "[友链申请] Test", body: "private", created_at: "2026-07-15T10:00:00Z", state: "open", labels: [{ name: "审核中" }] }]), { status: 200 });
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 200);
	assert.equal(res.body.count, 1);
	assert.deepEqual(Object.keys(res.body.items[0]), ["number", "title", "createdAt", "issueUrl"]);
	assert.match(res.headers["Cache-Control"], /s-maxage=60/);
});

test("pending GitHub failure uses stable error code", async () => {
	globalThis.fetch = async () => new Response("failed", { status: 500 });
	const res = response();
	await handler(request(), res);
	assert.equal(res.statusCode, 502);
	assert.equal(res.body.code, "GITHUB_ERROR");
});

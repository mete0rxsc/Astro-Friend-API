import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { extractImageUrl, readRawBody, sourceHash } from "../lib/image-upload.mjs";

test("sourceHash 对相同输入返回相同哈希，对不同输入返回不同哈希", () => {
	const a = sourceHash("1.2.3.4");
	const b = sourceHash("1.2.3.4");
	const c = sourceHash("5.6.7.8");
	assert.equal(a, b);
	assert.notEqual(a, c);
	assert.equal(a.length, 32);
});

test("sourceHash 空值回退到 unknown", () => {
	assert.equal(sourceHash(undefined), sourceHash("unknown"));
	assert.equal(sourceHash(""), sourceHash("unknown"));
});

test("extractImageUrl 从标准 Lsky Pro 响应中提取图片地址", () => {
	const payload = {
		status: true,
		code: 200,
		message: "success",
		data: {
			links: {
				url: "https://img.xscnet.cn/i/2026/09/05/abc123.png",
				html: '<img src="...">',
				markdown: "![...](...)",
			},
		},
	};
	assert.equal(extractImageUrl(payload), "https://img.xscnet.cn/i/2026/09/05/abc123.png");
});

test("extractImageUrl 兼容 data.url 简写格式", () => {
	const payload = { status: true, data: { url: "https://img.example.com/test.jpg" } };
	assert.equal(extractImageUrl(payload), "https://img.example.com/test.jpg");
});

test("extractImageUrl 对无效输入返回空字符串", () => {
	assert.equal(extractImageUrl(null), "");
	assert.equal(extractImageUrl(undefined), "");
	assert.equal(extractImageUrl({}), "");
	assert.equal(extractImageUrl({ data: { links: { url: "not-a-url" } } }), "");
});

test("readRawBody 正确拼接请求体", async () => {
	const stream = Readable.from([Buffer.from("Hello "), Buffer.from("World")]);
	const body = await readRawBody(stream, 1024);
	assert.equal(body.toString(), "Hello World");
});

test("readRawBody 超过大小限制时抛出 BODY_TOO_LARGE", async () => {
	const stream = Readable.from([Buffer.alloc(100)]);
	await assert.rejects(() => readRawBody(stream, 50), { message: "BODY_TOO_LARGE" });
});

test("readRawBody 空流返回空 Buffer", async () => {
	const stream = Readable.from([]);
	const body = await readRawBody(stream, 1024);
	assert.equal(body.length, 0);
});

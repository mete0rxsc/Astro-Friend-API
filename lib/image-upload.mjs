import { createHash } from "node:crypto";

export const ERROR_CODES = Object.freeze({
	CONFIG: "CONFIG_ERROR",
	FORBIDDEN: "ORIGIN_FORBIDDEN",
	INVALID: "INVALID_REQUEST",
	RATE_LIMITED: "RATE_LIMITED",
	TURNSTILE: "TURNSTILE_FAILED",
	TOO_LARGE: "FILE_TOO_LARGE",
	UNSUPPORTED: "UNSUPPORTED_MEDIA_TYPE",
	UPSTREAM: "LSKY_UPSTREAM_ERROR",
});

export const sourceHash = (value) =>
	createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 32);

// 读取原始请求体（multipart/form-data 不做解析，直接透传给 Lsky）
// 在读取过程中校验大小上限，避免大文件占满内存
export const readRawBody = (request, maxBytes) =>
	new Promise((resolve, reject) => {
		const chunks = [];
		let total = 0;
		request.on("data", (chunk) => {
			total += chunk.length;
			if (total > maxBytes) {
				reject(new Error("BODY_TOO_LARGE"));
				request.destroy();
				return;
			}
			chunks.push(chunk);
		});
		request.on("end", () => resolve(Buffer.concat(chunks)));
		request.on("error", reject);
	});

// 从 Lsky 响应中提取图片直链
// Lsky Pro 标准返回: { status: true, data: { links: { url: "..." } } }
export const extractImageUrl = (payload) => {
	if (!payload || typeof payload !== "object") return "";
	const direct = payload?.data?.links?.url;
	if (typeof direct === "string" && direct.startsWith("http")) return direct;
	// 兼容部分版本返回 data.url
	const fallback = payload?.data?.url;
	if (typeof fallback === "string" && fallback.startsWith("http")) return fallback;
	return "";
};

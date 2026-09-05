import config from "../config.mjs";
import { ERROR_CODES, extractImageUrl, readRawBody, sourceHash } from "../lib/image-upload.mjs";

const send = (response, status, code, message, extra = {}) =>
	response.status(status).json({
		ok: status >= 200 && status < 300,
		code,
		message,
		...extra,
	});

const allowedOrigins = () =>
	new Set(
		String(process.env.ALLOWED_ORIGINS || "")
			.split(",")
			.map((item) => item.trim().replace(/\/$/, ""))
			.filter(Boolean),
	);

const verifyTurnstile = async (token, ip) => {
	if (!config.imageUpload.turnstile.enabled) return true;
	if (!token || !process.env.TURNSTILE_SECRET_KEY) return false;
	const body = new URLSearchParams({
		secret: process.env.TURNSTILE_SECRET_KEY,
		response: token,
	});
	if (ip) body.set("remoteip", ip);
	const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
		method: "POST",
		body,
	});
	return result.ok && (await result.json()).success === true;
};

const enforceRateLimit = async (source) => {
	const endpoint = String(process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
	const token = process.env.UPSTASH_REDIS_REST_TOKEN;
	if (!endpoint || !token) throw new Error("UPSTASH_CONFIG");
	const key = `image-upload:${sourceHash(source)}:${Math.floor(Date.now() / (config.imageUpload.rateLimit.windowSeconds * 1000))}`;
	const result = await fetch(`${endpoint}/pipeline`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify([
			["INCR", key],
			["EXPIRE", key, config.imageUpload.rateLimit.windowSeconds, "NX"],
		]),
	});
	if (!result.ok) throw new Error("UPSTASH_ERROR");
	const payload = await result.json();
	return Number(payload?.[0]?.result ?? config.imageUpload.rateLimit.requests + 1) <= config.imageUpload.rateLimit.requests;
};

export default async function handler(request, response) {
	response.setHeader("Cache-Control", "no-store");

	const origin = String(request.headers.origin || "").replace(/\/$/, "");
	const origins = allowedOrigins();
	if (origin && origins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
	response.setHeader("Vary", "Origin");
	response.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Turnstile-Token");
	response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");

	if (request.method === "OPTIONS") return response.status(204).end();
	if (request.method !== "POST") return send(response, 405, ERROR_CODES.INVALID, "仅支持 POST 请求。");
	if (!origin || !origins.has(origin)) return send(response, 403, ERROR_CODES.FORBIDDEN, "请求来源不在允许列表中。");

	// 环境变量检查
	if (
		!process.env.LSKY_UPLOAD_URL ||
		!process.env.LSKY_API_TOKEN ||
		!process.env.UPSTASH_REDIS_REST_URL ||
		!process.env.UPSTASH_REDIS_REST_TOKEN
	) {
		return send(response, 503, ERROR_CODES.CONFIG, "图片上传服务尚未完成配置。");
	}

	// 必须是 multipart/form-data
	const contentType = String(request.headers["content-type"] || "");
	if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
		return send(response, 415, ERROR_CODES.UNSUPPORTED, "仅支持 multipart/form-data 格式的文件上传。");
	}

	// 提前检查 content-length，避免读取超大请求体
	const contentLength = Number(request.headers["content-length"] || 0);
	const maxBytes = config.imageUpload.maxFileSizeBytes;
	if (contentLength > maxBytes) {
		return send(response, 413, ERROR_CODES.TOO_LARGE, `文件过大，最大允许 ${Math.round(maxBytes / 1024)} KB。`);
	}

	const ip = String(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "").split(",")[0].trim();

	// 限流
	try {
		if (!(await enforceRateLimit(ip || origin))) {
			response.setHeader("Retry-After", String(config.imageUpload.rateLimit.windowSeconds));
			return send(response, 429, ERROR_CODES.RATE_LIMITED, "上传过于频繁，请稍后再试。");
		}
	} catch {
		return send(response, 503, ERROR_CODES.CONFIG, "限流服务暂不可用，请稍后再试。");
	}

	// 可选 Turnstile 人机验证（token 通过 X-Turnstile-Token 请求头传递）
	if (config.imageUpload.turnstile.enabled) {
		const turnstileToken = String(request.headers["x-turnstile-token"] || "");
		if (!(await verifyTurnstile(turnstileToken, ip))) {
			return send(response, 400, ERROR_CODES.TURNSTILE, "人机验证失败，请重新验证后再上传。");
		}
	}

	// 读取原始请求体（不解析 multipart，直接透传）
	let rawBody;
	try {
		rawBody = await readRawBody(request, maxBytes);
	} catch {
		return send(response, 413, ERROR_CODES.TOO_LARGE, `文件过大，最大允许 ${Math.round(maxBytes / 1024)} KB。`);
	}
	if (!rawBody || rawBody.length === 0) {
		return send(response, 400, ERROR_CODES.INVALID, "未接收到文件内容。");
	}

	// 转发到 Lsky
	try {
		const lskyResponse = await fetch(process.env.LSKY_UPLOAD_URL, {
			method: "POST",
			headers: {
				"Content-Type": contentType,
				Authorization: `Bearer ${process.env.LSKY_API_TOKEN}`,
				"User-Agent": "Mete0r-Image-Upload-Proxy",
			},
			body: rawBody,
		});

		const lskyPayload = await lskyResponse.json().catch(() => null);

		if (!lskyResponse.ok || !lskyPayload) {
			const upstreamMessage =
				lskyPayload?.message || `Lsky 返回状态码 ${lskyResponse.status}`;
			return send(response, 502, ERROR_CODES.UPSTREAM, `图床服务异常：${upstreamMessage}`);
		}

		const imageUrl = extractImageUrl(lskyPayload);
		if (!imageUrl) {
			return send(response, 502, ERROR_CODES.UPSTREAM, "图床返回中未找到图片地址，请检查 Lsky 接口格式。");
		}

		return send(response, 200, "OK", "上传成功。", { url: imageUrl });
	} catch {
		return send(response, 502, ERROR_CODES.UPSTREAM, "无法连接到图床服务，请稍后重试。");
	}
}

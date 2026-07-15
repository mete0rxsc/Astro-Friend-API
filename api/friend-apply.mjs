import config from "../config.mjs";
import {
	ERROR_CODES,
	buildIssue,
	extractIssueUrl,
	normalizeSiteUrl,
	sourceHash,
	validateApplication,
} from "../lib/friend-apply.mjs";

const repository = config.repository ?? {};

const send = (response, status, code, message, extra = {}) => response.status(status).json({
	ok: status >= 200 && status < 300,
	code,
	message,
	...extra,
});

const allowedOrigins = () => new Set(
	String(process.env.ALLOWED_ORIGINS || "")
		.split(",")
		.map((item) => item.trim().replace(/\/$/, ""))
		.filter(Boolean),
);

const githubHeaders = () => ({
	Accept: "application/vnd.github+json",
	Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
	"Content-Type": "application/json",
	"User-Agent": "Mete0r-AstroBlog-Friend-Apply",
	"X-GitHub-Api-Version": "2022-11-28",
});

const verifyTurnstile = async (token, ip) => {
	if (config.turnstile?.enabled === false) return true;
	if (!token || !process.env.TURNSTILE_SECRET_KEY) return false;
	const body = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY, response: token });
	if (ip) body.set("remoteip", ip);
	const result = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", { method: "POST", body });
	return result.ok && (await result.json()).success === true;
};

const enforceRateLimit = async (source) => {
	const endpoint = String(process.env.UPSTASH_REDIS_REST_URL || "").replace(/\/$/, "");
	const token = process.env.UPSTASH_REDIS_REST_TOKEN;
	if (!endpoint || !token) throw new Error("UPSTASH_CONFIG");
	const windowSeconds = Math.max(60, Number(config.rateLimit?.windowSeconds ?? 3600));
	const limit = Math.max(1, Number(config.rateLimit?.requests ?? 3));
	const key = `friend-apply:${sourceHash(source)}:${Math.floor(Date.now() / (windowSeconds * 1000))}`;
	const result = await fetch(`${endpoint}/pipeline`, {
		method: "POST",
		headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify([["INCR", key], ["EXPIRE", key, windowSeconds, "NX"]]),
	});
	if (!result.ok) throw new Error("UPSTASH_ERROR");
	const payload = await result.json();
	const count = Number(payload?.[0]?.result ?? limit + 1);
	return { allowed: count <= limit, retryAfter: windowSeconds };
};

const findDuplicate = async (targetUrl) => {
	const pages = Math.max(1, Math.min(10, Number(config.validation?.duplicateIssuePages ?? 3)));
	const normalizedTarget = normalizeSiteUrl(targetUrl);
	for (let page = 1; page <= pages; page += 1) {
		const response = await fetch(
			`https://api.github.com/repos/${repository.owner}/${repository.name}/issues?state=all&per_page=100&page=${page}`,
			{ headers: githubHeaders() },
		);
		if (!response.ok) throw new Error("GITHUB_DUPLICATE_CHECK");
		const issues = await response.json();
		if (issues.some((issue) => !issue.pull_request && extractIssueUrl(issue.body) === normalizedTarget)) return true;
		if (issues.length < 100) break;
	}
	return false;
};

const createIssue = async (application) => {
	const issue = buildIssue(application);
	const response = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/issues`, {
		method: "POST",
		headers: githubHeaders(),
		body: JSON.stringify({ ...issue, labels: [repository.pendingLabel || "审核中"] }),
	});
	if (!response.ok) throw new Error("GITHUB_CREATE");
	return response.json();
};

export default async function handler(request, response) {
	response.setHeader("Cache-Control", "no-store");
	const origin = String(request.headers.origin || "").replace(/\/$/, "");
	const origins = allowedOrigins();
	if (origin && origins.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
	response.setHeader("Vary", "Origin");
	response.setHeader("Access-Control-Allow-Headers", "Content-Type");
	response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
	if (request.method === "OPTIONS") return response.status(204).end();
	if (request.method !== "POST") return send(response, 405, ERROR_CODES.INVALID, "仅支持 POST 请求。");
	if (!origin || !origins.has(origin)) return send(response, 403, ERROR_CODES.FORBIDDEN, "请求来源不在允许列表中。");
	if (!config.enabled || !repository.owner || !repository.name || !process.env.GITHUB_TOKEN) {
		return send(response, 503, ERROR_CODES.CONFIG, "友链申请服务尚未完成配置。");
	}

	const ip = String(request.headers["x-forwarded-for"] || request.headers["x-real-ip"] || "").split(",")[0].trim();
	let application;
	let payload;
	try {
		payload = typeof request.body === "string" ? JSON.parse(request.body) : (request.body ?? {});
		application = validateApplication(payload, config);
	} catch {
		return send(response, 400, ERROR_CODES.INVALID, "表单内容不完整或格式不正确。");
	}

	try {
		const rate = await enforceRateLimit(ip || origin);
		if (!rate.allowed) {
			response.setHeader("Retry-After", String(rate.retryAfter));
			return send(response, 429, ERROR_CODES.RATE_LIMITED, "提交过于频繁，请稍后再试。");
		}
	} catch {
		return send(response, 503, ERROR_CODES.CONFIG, "限流服务暂不可用，请稍后再试。");
	}

	try {
		if (!(await verifyTurnstile(payload.turnstileToken, ip))) {
			return send(response, 400, ERROR_CODES.TURNSTILE, "人机验证失败，请重新验证。");
		}
		if (await findDuplicate(application.url)) {
			return send(response, 409, ERROR_CODES.DUPLICATE, "该网址已经提交过友链申请。");
		}
		const issue = await createIssue(application);
		return send(response, 201, "CREATED", "申请已提交，感谢你的耐心等待。", { issueUrl: issue.html_url });
	} catch {
		return send(response, 502, ERROR_CODES.GITHUB, "GitHub 暂时无法处理申请，请稍后重试。");
	}
}

import config from "../config.mjs";

const repository = config.repository;
const origins = () => new Set(String(process.env.ALLOWED_ORIGINS || "").split(",").map((item) => item.trim().replace(/\/$/, "")).filter(Boolean));
const githubHeaders = () => ({
	Accept: "application/vnd.github+json",
	Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
	"User-Agent": "Mete0r-Friend-Pending",
	"X-GitHub-Api-Version": "2022-11-28",
});
const cleanTitle = (title) => String(title ?? "").replace(/^\s*\[友链申请\]\s*/u, "").trim() || "未命名博客";
const issueUrl = (issue) => `https://github.com/${repository.owner}/${repository.name}/issues/${Number(issue.number)}`;

export const normalizePendingIssues = (issues) => (Array.isArray(issues) ? issues : [])
	.filter((issue) => !issue?.pull_request && issue?.state === "open"
		&& (issue.labels || []).some((label) => String(typeof label === "string" ? label : label?.name) === repository.pendingLabel))
	.sort((left, right) => Date.parse(right.created_at || 0) - Date.parse(left.created_at || 0))
	.slice(0, Math.max(1, Math.min(50, config.pending.maxItems)))
	.map((issue) => ({ number: Number(issue.number), title: cleanTitle(issue.title), createdAt: new Date(issue.created_at).toISOString(), issueUrl: issueUrl(issue) }));

export default async function handler(request, response) {
	const origin = String(request.headers.origin || "").replace(/\/$/, "");
	const allowed = origins();
	if (origin && allowed.has(origin)) response.setHeader("Access-Control-Allow-Origin", origin);
	response.setHeader("Access-Control-Allow-Headers", "Content-Type");
	response.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
	response.setHeader("Vary", "Origin");
	if (request.method === "OPTIONS") return response.status(204).end();
	if (request.method !== "GET") {
		response.setHeader("Cache-Control", "no-store");
		return response.status(405).json({ ok: false, code: "METHOD_NOT_ALLOWED", message: "仅支持 GET 请求。" });
	}
	if (!origin || !allowed.has(origin)) {
		response.setHeader("Cache-Control", "no-store");
		return response.status(403).json({ ok: false, code: "ORIGIN_FORBIDDEN", message: "请求来源不在允许列表中。" });
	}
	if (!config.pending.enabled || !process.env.GITHUB_TOKEN) {
		response.setHeader("Cache-Control", "no-store");
		return response.status(503).json({ ok: false, code: "CONFIG_ERROR", message: "审核列表服务尚未完成配置。" });
	}
	const query = new URLSearchParams({ state: "open", labels: repository.pendingLabel, sort: "created", direction: "desc", per_page: String(config.pending.maxItems) });
	try {
		const result = await fetch(`https://api.github.com/repos/${repository.owner}/${repository.name}/issues?${query}`, { headers: githubHeaders() });
		if (!result.ok) throw new Error(`GitHub ${result.status}`);
		const items = normalizePendingIssues(await result.json());
		response.setHeader("Cache-Control", `public, max-age=0, s-maxage=${config.pending.cacheSeconds}, stale-while-revalidate=${config.pending.cacheSeconds * 5}`);
		return response.status(200).json({ ok: true, count: items.length, items });
	} catch {
		response.setHeader("Cache-Control", "no-store");
		return response.status(502).json({ ok: false, code: "GITHUB_ERROR", message: "GitHub 审核列表暂时无法读取。" });
	}
}

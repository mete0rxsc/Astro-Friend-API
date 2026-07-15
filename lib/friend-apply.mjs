import { createHash } from "node:crypto";

export const ERROR_CODES = Object.freeze({
	CONFIG: "CONFIG_ERROR",
	FORBIDDEN: "ORIGIN_FORBIDDEN",
	INVALID: "INVALID_REQUEST",
	TURNSTILE: "TURNSTILE_FAILED",
	DUPLICATE: "DUPLICATE_URL",
	RATE_LIMITED: "RATE_LIMITED",
	GITHUB: "GITHUB_ERROR",
});

const CHECKS = [
	["legalCommitment", "合法的、非营利性、无商业广告、无木马植入。"],
	["crawlCommitment", "承诺不会对友链进行高频次爬取（若一次性爬取多个页面，则1天不超过1次；若仅访问feed地址，则1小时不超过1次），爬取过于频繁会被认为存在木马嫌疑。"],
	["originalContent", "有实质性原创内容的 HTTPS 站点，发布过至少 10 篇原创文章，内容题材不限。"],
	["independentDomain", "有独立域名，非免费域名。"],
	["threeYears", "博客已持续运行至少3年。"],
	["priorInteraction", "先友后链：与博主有至少1年的双向有效互动，例如互相留言评论、issue、PR等。"],
];

const cleanText = (value) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim();

export const normalizeSiteUrl = (value) => {
	const url = new URL(cleanText(value));
	url.hash = "";
	url.hostname = url.hostname.toLowerCase();
	url.pathname = url.pathname.replace(/\/+$/, "") || "/";
	return url.href.replace(/\/$/, "");
};

const validateUrl = (value, { required = false, max = 500, github = false } = {}) => {
	const clean = cleanText(value);
	if (!clean && !required) return "";
	if (!clean || clean.length > max) throw new Error("URL_INVALID");
	const url = new URL(clean);
	if (url.protocol !== "https:") throw new Error("URL_INVALID");
	if (github && url.hostname !== "github.com") throw new Error("URL_INVALID");
	return url.href;
};

export function validateApplication(input, config = {}) {
	const validation = config.validation ?? {};
	const title = cleanText(input.title);
	const description = cleanText(input.description);
	const titleMax = Number(validation.titleMax ?? 80);
	const descriptionMax = Number(validation.descriptionMax ?? 240);
	const urlMax = Number(validation.urlMax ?? 500);
	if (!title || title.length > titleMax || !description || description.length > descriptionMax) {
		throw new Error("TEXT_INVALID");
	}
	if (input.website) throw new Error("HONEYPOT");
	if (input.legalCommitment !== true || input.crawlCommitment !== true) throw new Error("COMMITMENT_REQUIRED");

	return {
		title,
		description,
		url: validateUrl(input.url, { required: true, max: urlMax }),
		icon: validateUrl(input.icon, { required: true, max: urlMax }),
		snapshot: validateUrl(input.snapshot, { max: urlMax }),
		feed: validateUrl(input.feed, { max: urlMax }),
		friendsPage: validateUrl(input.friendsPage, { required: true, max: urlMax }),
		friendsRepo: validateUrl(input.friendsRepo, { max: urlMax, github: true }),
		legalCommitment: true,
		crawlCommitment: true,
		originalContent: input.originalContent === true,
		independentDomain: input.independentDomain === true,
		threeYears: input.threeYears === true,
		priorInteraction: input.priorInteraction === true,
	};
}

export function buildIssue(application) {
	const data = {
		title: application.title,
		url: application.url,
		icon: application.icon,
		snapshot: application.snapshot,
		description: application.description,
		feed: application.feed,
	};
	const checks = CHECKS.map(([key, label]) => `- [${application[key] ? "x" : " "}] ${label}`).join("\n");
	return {
		title: `[友链申请] ${application.title}`,
		body: [
			"### 检查清单",
			checks,
			"",
			"### 友链信息",
			"```json",
			JSON.stringify(data, null, 4),
			"```",
			"",
			"### 友链地址",
			application.friendsPage,
			"",
			"### 友链仓库（可选）",
			application.friendsRepo || "未提供",
		].join("\n"),
	};
}

export function extractIssueUrl(body = "") {
	const match = String(body).match(/```json\s*([\s\S]*?)```/i);
	if (!match) return "";
	try {
		return normalizeSiteUrl(JSON.parse(match[1]).url);
	} catch {
		return "";
	}
}

export const sourceHash = (value) => createHash("sha256").update(String(value || "unknown")).digest("hex").slice(0, 32);

// Vercel 友链申请 API 的非敏感配置。密钥只允许放在 Vercel 环境变量中。
const config = {
	enabled: true,
	repository: {
		// 接收友链申请 Issue 的 GitHub 仓库。
		owner: "mete0rxsc",
		name: "HexoBlogFriends",
		// 此标签必须预先存在于目标仓库中。
		pendingLabel: "审核中",
	},
	turnstile: {
		// 生产环境必须保持开启；Secret Key 从 TURNSTILE_SECRET_KEY 读取。
		enabled: true,
	},
	rateLimit: {
		// 同一来源在一个窗口期内最多提交次数。
		requests: 3,
		// 限流窗口，单位秒。3600 表示一小时。
		windowSeconds: 3600,
	},
	validation: {
		// 博客名称最大字符数。
		titleMax: 80,
		// 博客简介最大字符数。
		descriptionMax: 240,
		// URL 字段最大字符数。
		urlMax: 500,
		// 重复申请检查最多读取的 GitHub Issue 页数，每页 100 条。
		duplicateIssuePages: 3,
	},
};

export default config;

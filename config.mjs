// 该文件只保存可公开的部署配置，任何密钥都必须填写到 Vercel 环境变量。
export default Object.freeze({
	repository: {
		// 只允许在这个仓库内创建和读取友链申请 Issue。
		owner: "mete0rxsc",
		name: "HexoBlogFriends",
		pendingLabel: "审核中",
	},
	turnstile: {
		// 关闭会削弱防刷能力，生产环境保持开启。
		enabled: true,
	},
	rateLimit: {
		// 同一来源每小时最多提交 3 次。
		requests: 3,
		windowSeconds: 3600,
	},
	validation: {
		// 表单字段最大长度，以及重复网址检查的 GitHub Issue 页数。
		titleMax: 80,
		descriptionMax: 240,
		urlMax: 500,
		duplicateIssuePages: 3,
	},
	pending: {
		// 审核列表最多返回 12 条，Vercel CDN 缓存 60 秒。
		enabled: true,
		maxItems: 12,
		cacheSeconds: 60,
	},
	imageUpload: {
		// 单文件最大字节数（2 MB），评论区贴图不需要大图。
		maxFileSizeBytes: 2 * 1024 * 1024,
		rateLimit: {
			// 同一来源每分钟最多上传 10 次。
			requests: 10,
			windowSeconds: 60,
		},
		turnstile: {
			// 评论区上传为高频操作，默认关闭人机验证；如需更严格的防刷可开启。
			// 开启后前端需要在上传时通过 X-Turnstile-Token 请求头传入 Turnstile token。
			enabled: false,
		},
	},
});

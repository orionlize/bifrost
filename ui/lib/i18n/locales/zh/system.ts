export const system = {
	configStoreMissing: {
		title: "缺少配置存储设置。",
		body: "界面需要数据库连接来存储配置数据，但当前未配置数据库。",
		hintBefore: "要启用界面，请在 config.json 中添加数据库设置（参见",
		hintAfter: "）。",
	},
	restartRequired: {
		title: "需要重启",
		defaultReason: "配置更改需要重启服务后才能生效。",
	},
	productionSetup: {
		title: "需要生产环境部署帮助？",
		description: "我们提供生产环境部署支持，包括定制集成与专属技术支持。",
		bookDemo: "预约团队演示",
	},
} as const;

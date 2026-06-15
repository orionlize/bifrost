export const modelCatalog = {
	stats: {
		totalProviders: "提供商总数",
		totalModels: "模型总数",
		totalRequests24h: "请求总数 (24h)",
		totalCost24h: "总成本 (24h)",
	},
	allProviders: "全部提供商",
	columns: {
		models: "模型",
		modelsTooltip: "最近 30 天使用过的模型",
		totalTraffic24h: "总流量 (24h)",
		totalCost24h: "总成本 (24h)",
	},
	noMatchingProviders: "未找到匹配的提供商。",
	moreModels: "还有 {{count}} 个",
	permission: "模型目录",
	empty: {
		title: "尚未配置任何提供商",
		description: "配置您的第一个模型提供商，以查看所有提供商、API 密钥、模型和使用指标的概览。",
		configureCta: "配置提供商",
	},
	loadFailed: "加载提供商失败",
} as const;
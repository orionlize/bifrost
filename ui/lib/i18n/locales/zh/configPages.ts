export const configPages = {
	headerForwarding: "请求头转发",
	pricingConfiguration: "定价配置",
	pluginLogs: "插件日志",
	localCacheTitle: "本地缓存",
	featureFlagsTitle: "功能开关",
	featureFlagsDesc: "切换进程内功能开关。开关在代码中声明；也可通过 config.json 或 Helm 设置，此时会在此显示为锁定状态。",
	featureFlagsEmpty: "尚未注册任何功能开关",
	loadingFeatureFlags: "正在加载功能开关...",
	loadingWebsiteSettings: "正在加载网站设置...",
	loadingAuthSettings: "正在加载认证设置",
} as const;
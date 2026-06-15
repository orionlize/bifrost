export const onboarding = {
	title: "设置清单",
	progress: "已完成 {{done}}/{{total}} 步",
	closeForNow: "暂时关闭",
	skip: "跳过",
	skipped: "已跳过",
	doLater: "稍后再说",
	hideForEveryone: "对所有人隐藏",
	sections: {
		security: "安全",
		providerSetup: "提供商设置",
		everythingElse: "其他",
	},
	steps: {
		cors: "限制 CORS 来源",
		dashboardAuth: "设置控制台认证",
		enforceInferenceAuth: "强制推理请求认证",
		providerKey: "添加提供商密钥",
		scim: "配置 SCIM 预配",
		models: "配置治理模型目录",
		virtualKeys: "设置用户 / 访问配置",
	},
} as const;
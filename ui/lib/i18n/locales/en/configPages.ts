export const configPages = {
	headerForwarding: "Header Forwarding",
	pricingConfiguration: "Pricing Configuration",
	pluginLogs: "Plugin Logs",
	localCacheTitle: "Local Cache",
	featureFlagsTitle: "Feature Flags",
	featureFlagsDesc:
		"Toggle in-process feature flags. Flags are declared in code; values can also be set via config.json or Helm, in which case they appear here as locked.",
	featureFlagsEmpty: "No feature flags registered yet",
	loadingFeatureFlags: "Loading feature flags...",
	loadingWebsiteSettings: "Loading website settings...",
	loadingAuthSettings: "Loading authentication settings",
} as const;

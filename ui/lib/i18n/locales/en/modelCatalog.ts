export const modelCatalog = {
	stats: {
		totalProviders: "Total Providers",
		totalModels: "Total Models",
		totalRequests24h: "Total Requests (24h)",
		totalCost24h: "Total Cost (24h)",
	},
	allProviders: "All Providers",
	columns: {
		models: "Models",
		modelsTooltip: "Models used in the last 30 days",
		totalTraffic24h: "Total Traffic (24h)",
		totalCost24h: "Total Cost (24h)",
	},
	noMatchingProviders: "No matching providers found.",
	moreModels: "+{{count}} more",
	permission: "model catalog",
	empty: {
		title: "No providers configured yet",
		description:
			"Configure your first model provider to see an overview of all providers, API keys, models, and usage metrics.",
		configureCta: "Configure Providers",
	},
	loadFailed: "Failed to load providers",
} as const;

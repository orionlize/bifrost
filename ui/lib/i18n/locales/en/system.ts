export const system = {
	configStoreMissing: {
		title: "Config store setup is missing.",
		body: "The UI requires a database connection to store configuration data, but no database is currently configured.",
		hintBefore: "To enable the UI, please add the database settings to your config.json (see",
		hintAfter: ").",
	},
	restartRequired: {
		title: "Restart Required",
		defaultReason: "Configuration changes require a server restart to take effect.",
	},
	productionSetup: {
		title: "Need help with production setup?",
		description: "We offer help with production setup including custom integrations and dedicated support.",
		bookDemo: "Book a demo with our team",
	},
} as const;
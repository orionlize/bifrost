export const onboarding = {
	title: "Setup checklist",
	progress: "{{done}} of {{total}} steps complete",
	closeForNow: "Close for now",
	skip: "Skip",
	skipped: "Skipped",
	doLater: "I'll do it later",
	hideForEveryone: "Hide for everyone",
	sections: {
		security: "Security",
		providerSetup: "Provider Setup",
		everythingElse: "Everything Else",
	},
	steps: {
		cors: "Restrict CORS origins",
		dashboardAuth: "Set up dashboard auth",
		enforceInferenceAuth: "Enforce auth on inference",
		providerKey: "Add a provider key",
		scim: "Configure SCIM provisioning",
		models: "Configure governance model catalog",
		virtualKeys: "Set up users / access profiles",
	},
} as const;
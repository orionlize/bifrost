export const WEBSITE_METADATA_KEY = "website";

export const DEFAULT_WEBSITE_NAME = "Bifrost";

export interface WebsiteConfig {
	name?: string;
	icon_url?: string;
	icon_dark_url?: string;
}

export const DefaultWebsiteConfig: WebsiteConfig = {};

export function parseWebsiteConfig(value: unknown): WebsiteConfig {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return { ...DefaultWebsiteConfig };
	}
	const raw = value as Record<string, unknown>;
	const legacyLogoUrl = typeof raw.logo_url === "string" ? raw.logo_url : undefined;
	const legacyLogoDarkUrl = typeof raw.logo_dark_url === "string" ? raw.logo_dark_url : undefined;
	return {
		name: typeof raw.name === "string" ? raw.name : undefined,
		icon_url: typeof raw.icon_url === "string" ? raw.icon_url : legacyLogoUrl,
		icon_dark_url: typeof raw.icon_dark_url === "string" ? raw.icon_dark_url : legacyLogoDarkUrl,
	};
}

export function websiteConfigFromMetadata(metadata: Record<string, unknown> | undefined): WebsiteConfig {
	return parseWebsiteConfig(metadata?.[WEBSITE_METADATA_KEY]);
}

export function normalizeWebsiteConfig(config: WebsiteConfig): WebsiteConfig | null {
	const trimmed: WebsiteConfig = {};
	const name = config.name?.trim();
	const iconUrl = config.icon_url?.trim();
	const iconDarkUrl = config.icon_dark_url?.trim();

	if (name) trimmed.name = name;
	if (iconUrl) trimmed.icon_url = iconUrl;
	if (iconDarkUrl) trimmed.icon_dark_url = iconDarkUrl;

	return Object.keys(trimmed).length > 0 ? trimmed : null;
}

export function websiteConfigEqual(a: WebsiteConfig, b: WebsiteConfig): boolean {
	return (
		(a.name ?? "") === (b.name ?? "") &&
		(a.icon_url ?? "") === (b.icon_url ?? "") &&
		(a.icon_dark_url ?? "") === (b.icon_dark_url ?? "")
	);
}

export function hasCustomWebsiteIcon(config: WebsiteConfig): boolean {
	return !!(config.icon_url?.trim() || config.icon_dark_url?.trim());
}

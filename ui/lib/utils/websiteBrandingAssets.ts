import {
	DEFAULT_WEBSITE_NAME,
	hasCustomWebsiteIcon,
	type WebsiteConfig,
} from "@/lib/types/websiteConfig";

export const DEFAULT_LOGO_LIGHT = "/bifrost-logo.webp";
export const DEFAULT_LOGO_DARK = "/bifrost-logo-dark.webp";
export const DEFAULT_ICON_LIGHT = "/bifrost-icon.webp";
export const DEFAULT_ICON_DARK = "/bifrost-icon-dark.webp";

export interface ResolvedWebsiteBrandingAssets {
	siteName: string;
	hasCustomName: boolean;
	hasCustomIcon: boolean;
	brandSrc: string;
	collapsedBrandSrc: string;
	faviconSrc: string;
}

export function resolveWebsiteBrandingAssets(config: WebsiteConfig, isDark: boolean): ResolvedWebsiteBrandingAssets {
	const customName = config.name?.trim() ?? "";
	const hasCustomName = customName.length > 0;
	const siteName = customName || DEFAULT_WEBSITE_NAME;
	const hasCustomIcon = hasCustomWebsiteIcon(config);

	const customIconSrc = isDark
		? config.icon_dark_url?.trim() || config.icon_url?.trim() || DEFAULT_ICON_DARK
		: config.icon_url?.trim() || DEFAULT_ICON_LIGHT;

	const brandSrc = hasCustomIcon ? customIconSrc : isDark ? DEFAULT_LOGO_DARK : DEFAULT_LOGO_LIGHT;
	const collapsedBrandSrc = hasCustomIcon ? customIconSrc : isDark ? DEFAULT_ICON_DARK : DEFAULT_ICON_LIGHT;
	const faviconSrc = hasCustomIcon ? customIconSrc : isDark ? DEFAULT_ICON_DARK : DEFAULT_ICON_LIGHT;

	return {
		siteName,
		hasCustomName,
		hasCustomIcon,
		brandSrc,
		collapsedBrandSrc,
		faviconSrc,
	};
}

import { type WebsiteConfig } from "@/lib/types/websiteConfig";
import { resolveWebsiteBrandingAssets } from "@/lib/utils/websiteBrandingAssets";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";
import { useWebsiteConfig } from "./useWebsiteConfig";

export interface WebsiteBranding extends ReturnType<typeof resolveWebsiteBrandingAssets> {
	config: WebsiteConfig;
	isLoaded: boolean;
	mounted: boolean;
}

export function useWebsiteBranding(options?: { preferPublicApi?: boolean }): WebsiteBranding {
	const { config, isLoaded } = useWebsiteConfig(options);
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
	}, []);

	const isDark = mounted && resolvedTheme === "dark";
	const assets = useMemo(() => resolveWebsiteBrandingAssets(config, isDark), [config, isDark]);

	return {
		config,
		isLoaded,
		mounted,
		...assets,
	};
}

export { DEFAULT_ICON_DARK, DEFAULT_ICON_LIGHT } from "@/lib/utils/websiteBrandingAssets";

export const websiteBrandingDefaults = {
	iconLight: "/bifrost-icon.webp",
	iconDark: "/bifrost-icon-dark.webp",
};
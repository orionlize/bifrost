import { useT } from "@/lib/i18n";
import { MarketplaceItem, MarketplacePlatform } from "@/lib/types/marketplace";
import { cn } from "@/lib/utils";

export function resolveMarketplacePlatform(platform?: MarketplacePlatform): MarketplacePlatform {
	return platform === "codex" ? "codex" : "claude";
}

export function groupMarketplaceItemsByPlatform(items: MarketplaceItem[]) {
	const claude: MarketplaceItem[] = [];
	const codex: MarketplaceItem[] = [];
	for (const item of items) {
		if (resolveMarketplacePlatform(item.platform) === "codex") {
			codex.push(item);
		} else {
			claude.push(item);
		}
	}
	return { claude, codex };
}

export function useMarketplacePlatformLabel(platform?: MarketplacePlatform, short = false) {
	const t = useT();
	const resolved = resolveMarketplacePlatform(platform);
	if (short) {
		return resolved === "codex" ? t("marketplace.platform.codexShort") : t("marketplace.platform.claudeShort");
	}
	return resolved === "codex" ? t("marketplace.platform.codex") : t("marketplace.platform.claude");
}

export function MarketplacePlatformLabel({
	platform,
	short = false,
	className,
}: {
	platform?: MarketplacePlatform;
	short?: boolean;
	className?: string;
}) {
	const label = useMarketplacePlatformLabel(platform, short);
	const resolved = resolveMarketplacePlatform(platform);

	return (
		<span
			className={cn("text-muted-foreground/75 font-normal", resolved === "codex" ? "text-muted-foreground/85" : "", className)}
			data-testid={`marketplace-platform-${resolved}`}
		>
			{label}
		</span>
	);
}
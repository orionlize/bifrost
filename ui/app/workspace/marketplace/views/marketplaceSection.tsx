import { useT } from "@/lib/i18n";
import { MarketplaceItem } from "@/lib/types/marketplace";
import { ReactNode } from "react";
import { groupMarketplaceItemsByPlatform } from "./marketplacePlatformBadge";
import { MarketplaceItemTile } from "./marketplaceItemTile";

interface MarketplaceSectionProps {
	title?: string;
	items: MarketplaceItem[];
	renderItem: (item: MarketplaceItem) => ReactNode;
	empty?: ReactNode;
	testId?: string;
}

export function MarketplaceSection({ title, items, renderItem, empty, testId }: MarketplaceSectionProps) {
	if (items.length === 0) {
		return empty ? <section className="space-y-3">{empty}</section> : null;
	}

	return (
		<section className="space-y-2.5" data-testid={testId}>
			{title && <h3 className="text-muted-foreground px-1 text-[12px] font-semibold tracking-wide">{title}</h3>}
			<div className="flex flex-wrap gap-x-2 gap-y-1">{items.map((item) => renderItem(item))}</div>
		</section>
	);
}

export function MarketplacePlatformSections({
	items,
	renderItem,
	empty,
}: {
	items: MarketplaceItem[];
	renderItem: (item: MarketplaceItem) => ReactNode;
	empty?: ReactNode;
}) {
	const t = useT();
	const { claude, codex } = groupMarketplaceItemsByPlatform(items);

	if (items.length === 0) {
		return empty ? <section className="space-y-3">{empty}</section> : null;
	}

	return (
		<div className="space-y-6">
			<MarketplaceSection
				title={t("marketplace.platform.claude")}
				items={claude}
				renderItem={renderItem}
				testId="marketplace-section-claude"
			/>
			<MarketplaceSection
				title={t("marketplace.platform.codex")}
				items={codex}
				renderItem={renderItem}
				testId="marketplace-section-codex"
			/>
		</div>
	);
}

export function defaultTileRenderer(
	item: MarketplaceItem,
	handlers: {
		onEdit: (item: MarketplaceItem) => void;
		onDelete: (item: MarketplaceItem) => void;
		onSync?: (item: MarketplaceItem) => void;
	},
) {
	return (
		<MarketplaceItemTile
			key={item.id}
			item={item}
			onEdit={() => handlers.onEdit(item)}
			onDelete={() => handlers.onDelete(item)}
			onSync={handlers.onSync ? () => handlers.onSync?.(item) : undefined}
		/>
	);
}
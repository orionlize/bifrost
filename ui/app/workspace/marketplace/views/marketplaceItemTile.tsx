import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdownMenu";
import { useT } from "@/lib/i18n";
import { MarketplaceItem } from "@/lib/types/marketplace";
import { cn } from "@/lib/utils";
import { EllipsisIcon, PencilIcon, RefreshCwIcon, Trash2Icon } from "lucide-react";
import { MarketplaceItemIcon } from "./marketplaceItemIcon";

interface MarketplaceItemTileProps {
	item: MarketplaceItem;
	onEdit: () => void;
	onDelete: () => void;
	onSync?: () => void;
}

export function MarketplaceItemTile({ item, onEdit, onDelete, onSync }: MarketplaceItemTileProps) {
	const t = useT();
	const canSync =
		item.source_type === "github" || item.source_type === "gitlab" || item.source_type === "catalog";
	const subtitle =
		item.description?.trim() ||
		(item.item_type === "plugin" ? t("marketplace.card.typePlugin") : t("marketplace.card.typeSkill"));

	return (
		<div
			className={cn(
				"group relative flex w-[148px] flex-col gap-2.5 rounded-xl p-2 transition-colors hover:bg-muted/50",
				!item.enabled && "opacity-55",
			)}
			data-testid={`marketplace-item-${item.name}`}
		>
			<div className="relative mx-auto">
				<MarketplaceItemIcon item={item} size="xl" />
				<div className="absolute -top-1 -right-1 opacity-0 transition-opacity group-hover:opacity-100">
					<DropdownMenu>
						<DropdownMenuTrigger asChild>
							<Button variant="secondary" size="icon" className="size-7 rounded-full shadow-sm">
								<EllipsisIcon className="size-3.5" />
							</Button>
						</DropdownMenuTrigger>
						<DropdownMenuContent align="end">
							{canSync && onSync && (
								<DropdownMenuItem onClick={onSync} data-testid={`marketplace-sync-${item.name}`}>
									<RefreshCwIcon className="mr-2 size-4" />
									{t("marketplace.card.sync")}
								</DropdownMenuItem>
							)}
							<DropdownMenuItem onClick={onEdit}>
								<PencilIcon className="mr-2 size-4" />
								{t("marketplace.card.edit")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem variant="destructive" onClick={onDelete} data-testid={`marketplace-delete-${item.name}`}>
								<Trash2Icon className="mr-2 size-4" />
								{t("marketplace.card.delete")}
							</DropdownMenuItem>
						</DropdownMenuContent>
					</DropdownMenu>
				</div>
			</div>

			<div className="min-w-0 text-center">
				<p className="truncate text-[13px] leading-tight font-semibold">{item.name}</p>
				<p className="text-muted-foreground mt-0.5 line-clamp-2 text-[11px] leading-snug">{subtitle}</p>
			</div>

			<Button
				size="sm"
				variant="secondary"
				className="mx-auto h-7 w-[72px] rounded-full text-[11px] font-semibold opacity-0 transition-opacity group-hover:opacity-100"
				onClick={onEdit}
			>
				{t("marketplace.card.manage")}
			</Button>
		</div>
	);
}

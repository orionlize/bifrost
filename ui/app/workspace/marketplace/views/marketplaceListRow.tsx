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

interface MarketplaceListRowProps {
	item: MarketplaceItem;
	onEdit: () => void;
	onDelete: () => void;
	onSync?: () => void;
}

export function MarketplaceListRow({ item, onEdit, onDelete, onSync }: MarketplaceListRowProps) {
	const t = useT();
	const canSync = item.source_type === "github" || item.source_type === "gitlab" || item.source_type === "catalog";
	const meta = [
		item.item_type,
		item.version ? t("marketplace.card.version", { version: item.version }) : null,
		item.source_type,
		!item.enabled ? t("marketplace.card.disabled") : null,
	]
		.filter(Boolean)
		.join(" · ");

	return (
		<div
			className={cn(
				"group flex items-center gap-4 rounded-xl px-3 py-2.5 transition-colors hover:bg-muted/45",
				!item.enabled && "opacity-55",
			)}
			data-testid={`marketplace-item-${item.name}`}
		>
			<MarketplaceItemIcon item={item} size="md" className="shadow-sm" />

			<div className="min-w-0 flex-1">
				<p className="truncate text-[13px] font-semibold">{item.name}</p>
				<p className="text-muted-foreground truncate text-[11px]">{item.description || t("marketplace.card.noDescription")}</p>
				{meta && <p className="text-muted-foreground/80 mt-0.5 truncate text-[10px] capitalize">{meta}</p>}
			</div>

			<div className="flex shrink-0 items-center gap-2">
				<Button size="sm" variant="secondary" className="h-7 rounded-full px-4 text-[11px] font-semibold" onClick={onEdit}>
					{t("marketplace.card.manage")}
				</Button>
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button variant="ghost" size="icon" className="size-8 opacity-0 group-hover:opacity-100">
							<EllipsisIcon className="size-4" />
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
	);
}
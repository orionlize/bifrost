import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scrollArea";
import { useIsLocalAdminSession } from "@/hooks/useIsLocalAdminSession";
import { useT } from "@/lib/i18n";
import {
	useDeleteMarketplaceItemMutation,
	useGetMarketplaceConfigQuery,
	useListMarketplaceItemsQuery,
	useSyncMarketplaceItemMutation,
} from "@/lib/store/apis/marketplaceApi";
import { MarketplaceItem } from "@/lib/types/marketplace";
import { PlusIcon, SearchIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MarketplaceImportDialog } from "./marketplaceImportDialog";
import { MarketplaceEmptyState } from "./marketplaceEmptyState";
import { MarketplaceListRow } from "./marketplaceListRow";
import { defaultTileRenderer, MarketplacePlatformSections } from "./marketplaceSection";
import { groupMarketplaceItemsByPlatform } from "./marketplacePlatformBadge";
import { MarketplaceSettingsPanel } from "./marketplaceSettingsPanel";

export type MarketplaceViewId = "plugin" | "skill" | "settings";

type EditorState = {
	mode: "create" | "edit";
	item?: MarketplaceItem;
};

export default function MarketplaceView({ activeView }: { activeView: MarketplaceViewId }) {
	const t = useT();
	const isLocalAdmin = useIsLocalAdminSession();
	const [search, setSearch] = useState("");
	const [editor, setEditor] = useState<EditorState | null>(null);

	const { data, isLoading } = useListMarketplaceItemsQuery({ search, limit: 100 }, { skip: activeView === "settings" });
	const { data: configData } = useGetMarketplaceConfigQuery(undefined, { skip: !isLocalAdmin });
	const [syncItem] = useSyncMarketplaceItemMutation();
	const [deleteItem] = useDeleteMarketplaceItemMutation();

	const items = data?.items ?? [];
	const plugins = useMemo(() => items.filter((item) => item.item_type === "plugin"), [items]);
	const skills = useMemo(() => items.filter((item) => item.item_type === "skill"), [items]);
	const isSearchMode = search.trim().length > 0;

	const claudeManifestURL = useMemo(() => {
		if (typeof window === "undefined") return "/.claude-plugin/marketplace.json";
		return `${window.location.origin}/.claude-plugin/marketplace.json`;
	}, []);
	const codexManifestURL = useMemo(() => {
		if (typeof window === "undefined") return "/.agents/plugins/marketplace.json";
		return `${window.location.origin}/.agents/plugins/marketplace.json`;
	}, []);

	const itemHandlers = {
		onEdit: (item: MarketplaceItem) => setEditor({ mode: "edit", item }),
		onDelete: async (item: MarketplaceItem) => {
			try {
				await deleteItem(item.id).unwrap();
				toast.success(t("marketplace.toast.deleted"));
			} catch {
				toast.error(t("marketplace.toast.deleteFailed"));
			}
		},
		onSync: async (item: MarketplaceItem) => {
			try {
				await syncItem({ id: item.id }).unwrap();
				toast.success(t("marketplace.toast.synced"));
			} catch {
				toast.error(t("marketplace.toast.syncFailed"));
			}
		},
	};

	const renderListRow = (item: MarketplaceItem) => (
		<MarketplaceListRow
			key={item.id}
			item={item}
			onEdit={() => itemHandlers.onEdit(item)}
			onDelete={() => itemHandlers.onDelete(item)}
			onSync={
				item.source_type === "github" || item.source_type === "gitlab" || item.source_type === "catalog"
					? () => itemHandlers.onSync(item)
					: undefined
			}
		/>
	);

	const renderTile = (item: MarketplaceItem) => defaultTileRenderer(item, itemHandlers);
	const { claude: searchClaude, codex: searchCodex } = useMemo(() => groupMarketplaceItemsByPlatform(items), [items]);

	return (
		<div
			className="no-padding-parent no-border-parent bg-background flex h-[calc(100vh-16px)] w-full overflow-hidden"
			data-testid="marketplace-page"
		>
			<div className="bg-card flex min-w-0 flex-1 flex-col overflow-hidden rounded-xl">
				{activeView !== "settings" && (
					<div className="flex shrink-0 items-center gap-2 px-3 pt-3 pb-2">
						<div className="relative min-w-0 flex-1 sm:max-w-xs md:max-w-sm">
							<SearchIcon className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
							<Input
								value={search}
								onChange={(e) => setSearch(e.target.value)}
								placeholder={t("marketplace.searchPlaceholder")}
								className="h-8 w-full rounded-lg border-0 bg-muted/70 pl-8 text-[13px] shadow-none focus-visible:ring-1"
								data-testid="marketplace-search-input"
							/>
						</div>
						<Button
							size="sm"
							className="h-8 shrink-0 gap-1.5 rounded-lg px-3 text-[13px]"
							onClick={() => setEditor({ mode: "create" })}
							data-testid="marketplace-add-button"
						>
							<PlusIcon className="size-3.5" />
							{t("marketplace.addItem")}
						</Button>
					</div>
				)}

				<ScrollArea className="flex-1">
					<div className={activeView === "settings" ? "px-6 py-4" : "px-3 py-3"}>
						{isLoading && activeView !== "settings" && (
							<p className="text-muted-foreground text-[13px]">{t("marketplace.loading")}</p>
						)}

						{activeView === "settings" && (
							<MarketplaceSettingsPanel
								claudeManifestURL={claudeManifestURL}
								codexManifestURL={codexManifestURL}
								config={configData?.marketplace}
								isAdmin={isLocalAdmin}
								embedded
							/>
						)}

						{!isLoading && activeView !== "settings" && isSearchMode && (
							<div className="space-y-6">
								{items.length === 0 ? (
									<MarketplaceEmptyState activeView={activeView} onImport={() => setEditor({ mode: "create" })} />
								) : (
									<>
										{searchClaude.length > 0 && (
											<section className="space-y-2" data-testid="marketplace-section-claude">
												<h3 className="text-muted-foreground px-1 text-[12px] font-semibold tracking-wide">
													{t("marketplace.platform.claude")}
												</h3>
												<div className="space-y-1">{searchClaude.map(renderListRow)}</div>
											</section>
										)}
										{searchCodex.length > 0 && (
											<section className="space-y-2" data-testid="marketplace-section-codex">
												<h3 className="text-muted-foreground px-1 text-[12px] font-semibold tracking-wide">
													{t("marketplace.platform.codex")}
												</h3>
												<div className="space-y-1">{searchCodex.map(renderListRow)}</div>
											</section>
										)}
									</>
								)}
							</div>
						)}

						{!isLoading && activeView !== "settings" && !isSearchMode && activeView === "plugin" && (
							<MarketplacePlatformSections
								items={plugins}
								renderItem={renderTile}
								empty={
									<MarketplaceEmptyState
										activeView={activeView}
										onImport={() => setEditor({ mode: "create" })}
										compact
									/>
								}
							/>
						)}

						{!isLoading && activeView !== "settings" && !isSearchMode && activeView === "skill" && (
							<MarketplacePlatformSections
								items={skills}
								renderItem={renderTile}
								empty={
									<MarketplaceEmptyState
										activeView={activeView}
										onImport={() => setEditor({ mode: "create" })}
										compact
									/>
								}
							/>
						)}
					</div>
				</ScrollArea>
			</div>

			<MarketplaceImportDialog editor={editor} importContext={activeView} onClose={() => setEditor(null)} />
		</div>
	);
}

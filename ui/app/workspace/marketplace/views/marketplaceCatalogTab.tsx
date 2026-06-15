import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scrollArea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { useGetMarketplaceConfigQuery, useLazyPreviewCatalogQuery } from "@/lib/store/apis/marketplaceApi";
import { MarketplaceCatalogSource, MarketplacePlatform, RemoteCatalogPlugin } from "@/lib/types/marketplace";
import { cn } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export function MarketplaceCatalogTab({
	platform,
	selectedSourceId,
	onSelectSourceId,
	selectedPlugin,
	onSelectPlugin,
}: {
	platform: MarketplacePlatform;
	selectedSourceId: string;
	onSelectSourceId: (sourceId: string) => void;
	selectedPlugin: string;
	onSelectPlugin: (plugin: RemoteCatalogPlugin, source: MarketplaceCatalogSource) => void;
}) {
	const t = useT();
	const { data: configData } = useGetMarketplaceConfigQuery();
	const [previewCatalog, { data: previewData, isFetching }] = useLazyPreviewCatalogQuery();
	const [pluginSearch, setPluginSearch] = useState("");

	const enabledSources = useMemo(
		() =>
			(configData?.marketplace.catalog_sources ?? []).filter(
				(source) => source.enabled !== false && (source.platform ?? "claude") === platform,
			),
		[configData?.marketplace.catalog_sources, platform],
	);

	const selectedSource = useMemo(
		() => enabledSources.find((source) => source.id === selectedSourceId) ?? enabledSources[0],
		[enabledSources, selectedSourceId],
	);

	useEffect(() => {
		if (!selectedSourceId && enabledSources[0]) {
			onSelectSourceId(enabledSources[0].id);
		}
	}, [enabledSources, onSelectSourceId, selectedSourceId]);

	useEffect(() => {
		if (!selectedSource?.url) return;
		void previewCatalog(selectedSource.url).catch(() => {
			toast.error(t("marketplace.catalog.loadFailed"));
		});
	}, [previewCatalog, selectedSource?.url, t]);

	const plugins = previewData?.catalog.plugins ?? [];
	const filteredPlugins = useMemo(() => {
		const query = pluginSearch.trim().toLowerCase();
		if (!query) return plugins;
		return plugins.filter(
			(plugin) =>
				plugin.name.toLowerCase().includes(query) ||
				(plugin.description ?? "").toLowerCase().includes(query) ||
				(plugin.category ?? "").toLowerCase().includes(query),
		);
	}, [pluginSearch, plugins]);

	if (enabledSources.length === 0) {
		return (
			<div className="grid gap-2 pt-2">
				<p className="text-muted-foreground text-[13px]">
					{platform === "codex" ? t("marketplace.catalog.noConfiguredCodexSources") : t("marketplace.catalog.noConfiguredSources")}
				</p>
				<Link
					to="/workspace/marketplace/settings"
					className="text-primary text-[13px] font-medium hover:underline"
					data-testid="marketplace-catalog-go-settings"
				>
					{t("marketplace.catalog.configureSources")}
				</Link>
			</div>
		);
	}

	return (
		<div className="grid gap-3 pt-2">
			<div className="grid gap-2">
				<Label>{t("marketplace.catalog.selectSource")}</Label>
				<Select
					value={selectedSource?.id ?? ""}
					onValueChange={(value) => {
						onSelectSourceId(value);
						setPluginSearch("");
					}}
				>
					<SelectTrigger data-testid="marketplace-catalog-source-select">
						<SelectValue placeholder={t("marketplace.catalog.selectSource")} />
					</SelectTrigger>
					<SelectContent>
						{enabledSources.map((source) => (
							<SelectItem key={source.id} value={source.id}>
								<div className="flex items-center gap-2">
									<span>{source.label}</span>
									{source.official && (
										<Badge variant="secondary" className="text-[10px]">
											{t("marketplace.catalog.official")}
										</Badge>
									)}
								</div>
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			</div>

			{selectedSource && (
				<div className="grid gap-2">
					<div className="flex items-center justify-between gap-2">
						<div className="min-w-0">
							<p className="truncate text-sm font-medium">{previewData?.catalog.name ?? selectedSource.label}</p>
							<p className="text-muted-foreground truncate text-xs">
								{isFetching
									? t("common.actions.loading")
									: t("marketplace.catalog.pluginCount", {
											count: String(previewData?.catalog.plugin_count ?? plugins.length),
										})}
							</p>
						</div>
					</div>
					<Input
						value={pluginSearch}
						onChange={(e) => setPluginSearch(e.target.value)}
						placeholder={t("marketplace.catalog.searchPlugins")}
					/>
					<ScrollArea className="h-56 rounded-lg border">
						<div className="divide-y">
							{filteredPlugins.map((plugin) => {
								const active = selectedPlugin === plugin.name;
								return (
									<button
										key={plugin.name}
										type="button"
										className={cn("hover:bg-muted/50 w-full px-3 py-2.5 text-left transition-colors", active && "bg-primary/8")}
										onClick={() => selectedSource && onSelectPlugin(plugin, selectedSource)}
										data-testid={`marketplace-catalog-plugin-${plugin.name}`}
									>
										<div className="flex items-start justify-between gap-2">
											<div className="min-w-0">
												<p className="truncate text-[13px] font-medium">{plugin.name}</p>
												<p className="text-muted-foreground line-clamp-2 text-[11px]">{plugin.description}</p>
											</div>
											{plugin.category && (
												<Badge variant="outline" className="shrink-0 text-[10px] capitalize">
													{plugin.category}
												</Badge>
											)}
										</div>
									</button>
								);
							})}
							{!isFetching && filteredPlugins.length === 0 && (
								<p className="text-muted-foreground px-3 py-6 text-center text-xs">{t("marketplace.catalog.noPlugins")}</p>
							)}
						</div>
					</ScrollArea>
				</div>
			)}
		</div>
	);
}
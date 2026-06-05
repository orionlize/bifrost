import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { useListCatalogPresetsQuery } from "@/lib/store/apis/marketplaceApi";
import { MarketplaceCatalogSource, MarketplacePlatform } from "@/lib/types/marketplace";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { MarketplacePlatformLabel } from "./marketplacePlatformBadge";

function sourceKey(source: MarketplaceCatalogSource) {
	return `${source.id}:${source.url}`;
}

function inferCatalogSourcePlatform(url: string): MarketplacePlatform {
	return url.toLowerCase().includes("/.agents/plugins/") ? "codex" : "claude";
}

function resolveSourcePlatform(source: MarketplaceCatalogSource): MarketplacePlatform {
	return source.platform ?? inferCatalogSourcePlatform(source.url);
}

function CatalogSourceRow({
	source,
	onToggleEnabled,
	onDelete,
}: {
	source: MarketplaceCatalogSource;
	onToggleEnabled: (enabled: boolean) => void;
	onDelete: () => void;
}) {
	const t = useT();

	return (
		<div
			className="flex flex-col gap-3 rounded-lg border bg-background/80 p-3 sm:flex-row sm:items-center sm:justify-between"
			data-testid={`marketplace-catalog-source-${source.id}`}
		>
			<div className="min-w-0 flex-1">
				<div className="flex flex-wrap items-center gap-2">
					<p className="truncate text-[13px] font-medium">{source.label}</p>
					<MarketplacePlatformLabel platform={resolveSourcePlatform(source)} short className="text-[10px]" />
					{source.official && (
						<Badge variant="secondary" className="text-[10px]">
							{t("marketplace.catalog.official")}
						</Badge>
					)}
				</div>
				<p className="text-muted-foreground truncate text-[11px]">{source.url}</p>
			</div>
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-2">
					<Switch
						checked={source.enabled !== false}
						onCheckedChange={onToggleEnabled}
						data-testid={`marketplace-catalog-source-enabled-${source.id}`}
					/>
					<span className="text-muted-foreground text-[11px]">{t("marketplace.source.enabled")}</span>
				</div>
				<Button
					type="button"
					variant="ghost"
					size="icon"
					className="size-8 shrink-0"
					onClick={onDelete}
					data-testid={`marketplace-catalog-source-delete-${source.id}`}
				>
					<Trash2Icon className="size-4" />
				</Button>
			</div>
		</div>
	);
}

function CatalogSourcePlatformSection({
	platform,
	title,
	description,
	sources,
	availablePresets,
	onAddPreset,
	onToggleEnabled,
	onDelete,
}: {
	platform: MarketplacePlatform;
	title: string;
	description: string;
	sources: MarketplaceCatalogSource[];
	availablePresets: Array<{
		id: string;
		label: string;
		description: string;
		url: string;
		platform?: MarketplacePlatform;
		official?: boolean;
	}>;
	onAddPreset: (preset: (typeof availablePresets)[number]) => void;
	onToggleEnabled: (sourceId: string, enabled: boolean) => void;
	onDelete: (sourceId: string) => void;
}) {
	const t = useT();

	return (
		<div className="space-y-3 rounded-lg border bg-background/40 p-4">
			<div>
				<h4 className="text-[14px] font-semibold">{title}</h4>
				<p className="text-muted-foreground mt-1 text-[12px]">{description}</p>
			</div>

			{sources.length === 0 ? (
				<p className="text-muted-foreground rounded-lg border border-dashed px-4 py-5 text-center text-[12px]">
					{platform === "codex" ? t("marketplace.source.noCodexCatalogSources") : t("marketplace.source.noClaudeCatalogSources")}
				</p>
			) : (
				<div className="space-y-2">
					{sources.map((source) => (
						<CatalogSourceRow
							key={sourceKey(source)}
							source={source}
							onToggleEnabled={(enabled) => onToggleEnabled(source.id, enabled)}
							onDelete={() => onDelete(source.id)}
						/>
					))}
				</div>
			)}

			{availablePresets.length > 0 && (
				<div className="space-y-2">
					<Label className="text-[12px]">{t("marketplace.source.addOfficialPreset")}</Label>
					<div className="flex flex-wrap gap-2">
						{availablePresets.map((preset) => (
							<Button
								key={preset.id}
								type="button"
								size="sm"
								variant="outline"
								className="rounded-full"
								onClick={() => onAddPreset(preset)}
								data-testid={`marketplace-add-preset-${preset.id}`}
							>
								<PlusIcon className="size-3.5" />
								{preset.label}
							</Button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}

export function MarketplaceCatalogSourcesSection({
	sources,
	onChangeSources,
}: {
	sources: MarketplaceCatalogSource[];
	onChangeSources: (next: MarketplaceCatalogSource[]) => void;
}) {
	const t = useT();
	const { data: presetsData } = useListCatalogPresetsQuery();
	const [customLabel, setCustomLabel] = useState("");
	const [customURL, setCustomURL] = useState("");
	const [customPlatform, setCustomPlatform] = useState<MarketplacePlatform>("claude");

	const configuredURLs = useMemo(() => new Set(sources.map((source) => source.url)), [sources]);
	const availablePresets = useMemo(
		() => (presetsData?.presets ?? []).filter((preset) => !configuredURLs.has(preset.url) && !configuredURLs.has(preset.id)),
		[configuredURLs, presetsData?.presets],
	);

	const claudeSources = useMemo(() => sources.filter((source) => resolveSourcePlatform(source) === "claude"), [sources]);
	const codexSources = useMemo(() => sources.filter((source) => resolveSourcePlatform(source) === "codex"), [sources]);
	const claudePresets = useMemo(
		() => availablePresets.filter((preset) => (preset.platform ?? "claude") === "claude"),
		[availablePresets],
	);
	const codexPresets = useMemo(
		() => availablePresets.filter((preset) => preset.platform === "codex"),
		[availablePresets],
	);

	const addSource = (source: Omit<MarketplaceCatalogSource, "id"> & { id?: string }) => {
		const next: MarketplaceCatalogSource = {
			id: source.id ?? "",
			label: source.label.trim(),
			url: source.url.trim(),
			platform: source.platform ?? inferCatalogSourcePlatform(source.url),
			description: source.description?.trim(),
			official: source.official,
			enabled: source.enabled ?? true,
		};
		if (!next.label || !next.url) return;
		if (sources.some((existing) => existing.url === next.url)) {
			toast.error(t("marketplace.source.duplicateSource"));
			return;
		}
		onChangeSources([...sources, next]);
	};

	const addCustomSource = () => {
		if (!customLabel.trim() || !customURL.trim()) {
			toast.error(t("marketplace.source.customRequired"));
			return;
		}
		addSource({
			label: customLabel.trim(),
			url: customURL.trim(),
			platform: customPlatform,
			enabled: true,
		});
		setCustomLabel("");
		setCustomURL("");
	};

	const updateSourceEnabled = (sourceId: string, enabled: boolean) => {
		onChangeSources(sources.map((existing) => (existing.id === sourceId ? { ...existing, enabled } : existing)));
	};

	const deleteSource = (sourceId: string) => {
		onChangeSources(sources.filter((existing) => existing.id !== sourceId));
	};

	return (
		<div className="space-y-4 rounded-xl border bg-muted/20 p-5">
			<div>
				<h3 className="text-[15px] font-semibold">{t("marketplace.source.catalogSourcesTitle")}</h3>
				<p className="text-muted-foreground mt-1 text-[13px]">{t("marketplace.source.catalogSourcesDescription")}</p>
			</div>

			<div className="grid gap-4 xl:grid-cols-2">
				<CatalogSourcePlatformSection
					platform="claude"
					title={t("marketplace.source.claudeCatalogSourcesTitle")}
					description={t("marketplace.source.claudeCatalogSourcesDescription")}
					sources={claudeSources}
					availablePresets={claudePresets}
					onAddPreset={(preset) =>
						addSource({
							id: preset.id,
							label: preset.label,
							url: preset.url,
							platform: preset.platform ?? "claude",
							description: preset.description,
							official: preset.official,
							enabled: true,
						})
					}
					onToggleEnabled={updateSourceEnabled}
					onDelete={deleteSource}
				/>
				<CatalogSourcePlatformSection
					platform="codex"
					title={t("marketplace.source.codexCatalogSourcesTitle")}
					description={t("marketplace.source.codexCatalogSourcesDescription")}
					sources={codexSources}
					availablePresets={codexPresets}
					onAddPreset={(preset) =>
						addSource({
							id: preset.id,
							label: preset.label,
							url: preset.url,
							platform: preset.platform ?? "codex",
							description: preset.description,
							official: preset.official,
							enabled: true,
						})
					}
					onToggleEnabled={updateSourceEnabled}
					onDelete={deleteSource}
				/>
			</div>

			<div className="space-y-3 rounded-lg border border-dashed p-4">
				<Label className="text-[13px]">{t("marketplace.source.addCustomSource")}</Label>
				<div className="grid gap-3 sm:grid-cols-3">
					<Input
						value={customLabel}
						onChange={(e) => setCustomLabel(e.target.value)}
						placeholder={t("marketplace.source.customLabelPlaceholder")}
						data-testid="marketplace-custom-source-label"
					/>
					<Input
						value={customURL}
						onChange={(e) => {
							setCustomURL(e.target.value);
							if (e.target.value.trim()) {
								setCustomPlatform(inferCatalogSourcePlatform(e.target.value));
							}
						}}
						placeholder={t("marketplace.source.customUrlPlaceholder")}
						data-testid="marketplace-custom-source-url"
						className="sm:col-span-1"
					/>
					<Select value={customPlatform} onValueChange={(value) => setCustomPlatform(value as MarketplacePlatform)}>
						<SelectTrigger data-testid="marketplace-custom-source-platform">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectItem value="claude">{t("marketplace.platform.claude")}</SelectItem>
							<SelectItem value="codex">{t("marketplace.platform.codex")}</SelectItem>
						</SelectContent>
					</Select>
				</div>
				<Button type="button" size="sm" variant="secondary" onClick={addCustomSource} data-testid="marketplace-add-custom-source">
					<PlusIcon className="size-3.5" />
					{t("marketplace.source.addCustomSourceAction")}
				</Button>
			</div>
		</div>
	);
}

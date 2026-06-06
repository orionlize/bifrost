import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useT } from "@/lib/i18n";
import {
	useGetMarketplaceItemAssignmentsQuery,
	useImportMarketplaceItemMutation,
	useReplaceMarketplaceItemAssignmentsMutation,
	useUpdateMarketplaceItemMutation,
	useUploadMarketplaceItemIconMutation,
} from "@/lib/store/apis/marketplaceApi";
import { MarketplaceImportSourceType, MarketplaceItem, MarketplacePlatform } from "@/lib/types/marketplace";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MarketplaceCatalogTab } from "./marketplaceCatalogTab";
import { MarketplaceItemAssignmentsSection, type MarketplaceAssignmentSelection } from "./marketplaceItemAssignmentsSection";
import { MarketplaceItemIcon } from "./marketplaceItemIcon";
import type { MarketplaceViewId } from "./marketplaceView";

type EditorState = {
	mode: "create" | "edit";
	item?: MarketplaceItem;
};

type ImportTab = MarketplaceImportSourceType;

export function MarketplaceImportDialog({
	editor,
	importContext,
	onClose,
}: {
	editor: EditorState | null;
	importContext: MarketplaceViewId;
	onClose: () => void;
}) {
	const t = useT();
	const [importItem] = useImportMarketplaceItemMutation();
	const [updateItem] = useUpdateMarketplaceItemMutation();
	const [replaceItemAssignments] = useReplaceMarketplaceItemAssignmentsMutation();
	const [uploadIcon] = useUploadMarketplaceItemIconMutation();

	const isPluginContext = importContext === "plugin";
	const showCatalogTab = isPluginContext;

	const [importTab, setImportTab] = useState<ImportTab>("zip");
	const [platform, setPlatform] = useState<MarketplacePlatform>("claude");
	const [enabled, setEnabled] = useState(true);
	const [zipFile, setZipFile] = useState<File | null>(null);
	const [remoteURL, setRemoteURL] = useState("");
	const [remoteRef, setRemoteRef] = useState("main");
	const [iconURL, setIconURL] = useState("");
	const [iconFile, setIconFile] = useState<File | null>(null);
	const [clearIcon, setClearIcon] = useState(false);
	const [catalogURL, setCatalogURL] = useState("");
	const [catalogSourceId, setCatalogSourceId] = useState("");
	const [catalogPlugin, setCatalogPlugin] = useState("");
	const [assignments, setAssignments] = useState<MarketplaceAssignmentSelection>({ users: [], departments: [] });

	const open = editor !== null;
	const isEdit = editor?.mode === "edit";
	const editItem = editor?.item;
	const { isLoading: editAssignmentsLoading } = useGetMarketplaceItemAssignmentsQuery(editItem?.id ?? 0, {
		skip: !isEdit || !editItem,
	});

	const tabCols = showCatalogTab ? "grid-cols-4" : "grid-cols-3";
	const lockedItemType = useMemo(() => {
		if (importContext === "plugin") return "plugin" as const;
		if (importContext === "skill") return "skill" as const;
		return undefined;
	}, [importContext]);

	useEffect(() => {
		if (!editor) return;
		if (editor.mode === "edit" && editor.item) {
			setEnabled(editor.item.enabled);
			setRemoteURL(editor.item.remote_url ?? "");
			setRemoteRef(editor.item.remote_ref ?? "main");
			setIconURL(editor.item.icon_url ?? "");
			setIconFile(null);
			setClearIcon(false);
			setAssignments({ users: [], departments: [] });
			return;
		}
		setImportTab("zip");
		setPlatform("claude");
		setEnabled(true);
		setZipFile(null);
		setRemoteURL("");
		setRemoteRef("main");
		setIconURL("");
		setIconFile(null);
		setClearIcon(false);
		setCatalogURL("");
		setCatalogSourceId("");
		setCatalogPlugin("");
		setAssignments({ users: [], departments: [] });
	}, [editor]);

	const handleSave = async () => {
		if (isEdit && editItem) {
			try {
				await updateItem({
					id: editItem.id,
					body: {
						enabled,
						icon_url: iconURL.trim() || undefined,
						clear_icon: clearIcon,
					},
				}).unwrap();
				await replaceItemAssignments({
					id: editItem.id,
					body: {
						users: assignments.users,
						departments: assignments.departments,
					},
				}).unwrap();
				if (iconFile) {
					await uploadIcon({ id: editItem.id, icon: iconFile }).unwrap();
				}
				toast.success(t("marketplace.toast.updated"));
				onClose();
			} catch {
				toast.error(t("marketplace.toast.updateFailed"));
			}
			return;
		}

		if (importTab === "zip" && !zipFile) {
			toast.error(t("marketplace.import.selectZip"));
			return;
		}
		if ((importTab === "github" || importTab === "gitlab") && !remoteURL.trim()) {
			toast.error(t("marketplace.import.repositoryRequired"));
			return;
		}
		if (importTab === "catalog") {
			if (!catalogURL.trim()) {
				toast.error(t("marketplace.catalog.sourceRequired"));
				return;
			}
			if (!catalogPlugin.trim()) {
				toast.error(t("marketplace.catalog.pluginRequired"));
				return;
			}
		}

		try {
			await importItem({
				source_type: importTab,
				platform,
				file: zipFile ?? undefined,
				icon: iconFile ?? undefined,
				icon_url: iconURL.trim() || undefined,
				remote_url: remoteURL.trim() || undefined,
				remote_ref: remoteRef.trim() || undefined,
				catalog_url: catalogURL.trim() || undefined,
				catalog_plugin: catalogPlugin.trim() || undefined,
				item_type: lockedItemType,
				enabled,
				assignments,
			}).unwrap();
			toast.success(t("marketplace.toast.imported"));
			onClose();
		} catch {
			toast.error(t("marketplace.toast.importFailed"));
		}
	};

	const gitAuthHint = (
		<p className="text-muted-foreground text-xs">
			{t("marketplace.import.gitAuthHint")}{" "}
			<Link to="/workspace/marketplace/settings" className="text-primary font-medium hover:underline">
				{t("marketplace.settings")}
			</Link>
		</p>
	);

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent className="max-w-2xl" data-testid="marketplace-item-dialog">
				<DialogHeader>
					<DialogTitle>{isEdit ? t("marketplace.editItem") : t("marketplace.importItem")}</DialogTitle>
				</DialogHeader>

				{isEdit && editItem ? (
					<div className="grid gap-4">
						<div className="flex items-center gap-4">
							<MarketplaceItemIcon item={editItem} size="md" />
							<div className="min-w-0">
								<p className="font-medium">{editItem.name}</p>
								<p className="text-muted-foreground text-sm capitalize">{editItem.item_type}</p>
								{editItem.description ? (
									<p className="text-muted-foreground mt-1 text-sm">{editItem.description}</p>
								) : null}
								{editItem.version ? (
									<p className="text-muted-foreground text-xs">v{editItem.version}</p>
								) : null}
							</div>
						</div>
						<p className="text-muted-foreground text-xs">{t("marketplace.import.metadataFromSource")}</p>
						{(editItem.source_type === "github" || editItem.source_type === "gitlab") && (
							<div className="grid gap-2">
								<Label>{t("marketplace.edit.remoteRepository")}</Label>
								<Input value={remoteURL} disabled />
								<Input value={remoteRef} disabled />
							</div>
						)}
						<div className="grid gap-2">
							<Label>{t("marketplace.import.iconUrl")}</Label>
							<Input
								value={iconURL}
								onChange={(e) => setIconURL(e.target.value)}
								placeholder={t("marketplace.import.iconUrlPlaceholder")}
							/>
						</div>
						<div className="grid gap-2">
							<Label>{t("marketplace.import.iconUpload")}</Label>
							<Input type="file" accept="image/*" onChange={(e) => setIconFile(e.target.files?.[0] ?? null)} />
							<p className="text-muted-foreground text-xs">{t("marketplace.import.iconHint")}</p>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox checked={clearIcon} onCheckedChange={(v) => setClearIcon(Boolean(v))} />
							<Label>{t("marketplace.edit.removeIcon")}</Label>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
							<Label>{t("marketplace.import.enabled")}</Label>
						</div>
						<MarketplaceItemAssignmentsSection
							key={editItem.id}
							itemId={editItem.id}
							value={assignments}
							onChange={setAssignments}
						/>
					</div>
				) : (
					<div className="grid gap-4">
						<div className="grid gap-2">
							<Label>{t("marketplace.platform.label")}</Label>
							<Select value={platform} onValueChange={(value) => setPlatform(value as MarketplacePlatform)}>
								<SelectTrigger className="w-full" data-testid="marketplace-import-platform">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="claude">{t("marketplace.platform.claude")}</SelectItem>
									<SelectItem value="codex">{t("marketplace.platform.codex")}</SelectItem>
								</SelectContent>
							</Select>
							<p className="text-muted-foreground text-xs">{t("marketplace.platform.importHint")}</p>
						</div>

						<Tabs value={importTab} onValueChange={(v) => setImportTab(v as ImportTab)}>
							<TabsList className={`grid w-full ${tabCols}`}>
								<TabsTrigger value="zip" data-testid="marketplace-import-tab-zip">
									{t("marketplace.import.zipTab")}
								</TabsTrigger>
								<TabsTrigger value="github" data-testid="marketplace-import-tab-github">
									{t("marketplace.import.githubTab")}
								</TabsTrigger>
								<TabsTrigger value="gitlab" data-testid="marketplace-import-tab-gitlab">
									{t("marketplace.import.gitlabTab")}
								</TabsTrigger>
								{showCatalogTab && (
									<TabsTrigger value="catalog" data-testid="marketplace-import-tab-catalog">
										{t("marketplace.import.catalogTab")}
									</TabsTrigger>
								)}
							</TabsList>
							<TabsContent value="zip" className="grid gap-3 pt-2">
								<div className="grid gap-2">
									<Label>{t("marketplace.import.zipFile")}</Label>
									<Input
										type="file"
										accept=".zip,application/zip"
										onChange={(e) => setZipFile(e.target.files?.[0] ?? null)}
										data-testid="marketplace-import-zip-file"
									/>
									<p className="text-muted-foreground text-xs">{t("marketplace.import.zipHint")}</p>
								</div>
							</TabsContent>
							<TabsContent value="github" className="grid gap-3 pt-2">
								<div className="grid gap-2">
									<Label>{t("marketplace.import.repositoryUrl")}</Label>
									<Input
										value={remoteURL}
										onChange={(e) => setRemoteURL(e.target.value)}
										placeholder={t("marketplace.import.githubPlaceholder")}
										data-testid="marketplace-import-remote-url"
									/>
								</div>
								<div className="grid gap-2">
									<Label>{t("marketplace.import.branchTag")}</Label>
									<Input value={remoteRef} onChange={(e) => setRemoteRef(e.target.value)} placeholder="main" />
								</div>
								{gitAuthHint}
							</TabsContent>
							<TabsContent value="gitlab" className="grid gap-3 pt-2">
								<div className="grid gap-2">
									<Label>{t("marketplace.import.repositoryUrl")}</Label>
									<Input
										value={remoteURL}
										onChange={(e) => setRemoteURL(e.target.value)}
										placeholder={t("marketplace.import.gitlabPlaceholder")}
									/>
								</div>
								<div className="grid gap-2">
									<Label>{t("marketplace.import.branchTag")}</Label>
									<Input value={remoteRef} onChange={(e) => setRemoteRef(e.target.value)} placeholder="main" />
								</div>
								{gitAuthHint}
							</TabsContent>
							{showCatalogTab && (
								<TabsContent value="catalog">
									<MarketplaceCatalogTab
										platform={platform}
										selectedSourceId={catalogSourceId}
										onSelectSourceId={setCatalogSourceId}
										selectedPlugin={catalogPlugin}
										onSelectPlugin={(plugin, source) => {
											setCatalogSourceId(source.id);
											setCatalogURL(source.url);
											setCatalogPlugin(plugin.name);
										}}
									/>
								</TabsContent>
							)}
						</Tabs>

						<p className="text-muted-foreground text-xs">{t("marketplace.import.metadataFromSource")}</p>
						<div className="grid gap-2">
							<Label>{t("marketplace.import.iconUrl")}</Label>
							<Input
								value={iconURL}
								onChange={(e) => setIconURL(e.target.value)}
								placeholder={t("marketplace.import.iconUrlPlaceholder")}
							/>
						</div>
						<div className="grid gap-2">
							<Label>{t("marketplace.import.iconUpload")}</Label>
							<Input type="file" accept="image/*" onChange={(e) => setIconFile(e.target.files?.[0] ?? null)} />
							<p className="text-muted-foreground text-xs">{t("marketplace.import.iconHint")}</p>
						</div>
						<div className="flex items-center gap-2">
							<Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
							<Label>{t("marketplace.import.enabled")}</Label>
						</div>
						<MarketplaceItemAssignmentsSection value={assignments} onChange={setAssignments} />
					</div>
				)}

				<DialogFooter>
					<Button variant="outline" onClick={onClose}>
						{t("common.actions.cancel")}
					</Button>
					<Button onClick={handleSave} disabled={isEdit && editAssignmentsLoading} data-testid="marketplace-item-save">
						{isEdit ? t("common.actions.save") : t("marketplace.importItem")}
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

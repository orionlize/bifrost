import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
	useCreateMarketplaceItemMutation,
	useDeleteMarketplaceItemMutation,
	useGetMarketplaceConfigQuery,
	useListMarketplaceItemsQuery,
	useUpdateMarketplaceConfigMutation,
	useUpdateMarketplaceItemMutation,
} from "@/lib/store/apis/marketplaceApi";
import { MarketplaceItem, MarketplaceItemType } from "@/lib/types/marketplace";
import { PlusIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

type EditorState = {
	mode: "create" | "edit";
	item?: MarketplaceItem;
};

export default function MarketplaceView() {
	const [search, setSearch] = useState("");
	const [editor, setEditor] = useState<EditorState | null>(null);
	const { data, isLoading, refetch } = useListMarketplaceItemsQuery({ search, limit: 100 });
	const { data: configData } = useGetMarketplaceConfigQuery();
	const [createItem] = useCreateMarketplaceItemMutation();
	const [updateItem] = useUpdateMarketplaceItemMutation();
	const [deleteItem] = useDeleteMarketplaceItemMutation();
	const [updateConfig] = useUpdateMarketplaceConfigMutation();

	const items = data?.items ?? [];
	const manifestURL = useMemo(() => {
		if (typeof window === "undefined") return "/.claude-plugin/marketplace.json";
		return `${window.location.origin}/.claude-plugin/marketplace.json`;
	}, []);

	return (
		<div className="flex h-full flex-col gap-6 p-6" data-testid="marketplace-page">
			<div className="flex items-start justify-between gap-4">
				<div>
					<h1 className="text-2xl font-semibold">Marketplace</h1>
					<p className="text-muted-foreground mt-1 text-sm">
						Manage skills and plugins, assign them to users, and expose a Claude Code compatible marketplace source.
					</p>
				</div>
				<Button data-testid="marketplace-create-button" onClick={() => setEditor({ mode: "create" })}>
					<PlusIcon className="mr-2 h-4 w-4" />
					Add item
				</Button>
			</div>

			<Card>
				<CardHeader>
					<CardTitle>Marketplace source</CardTitle>
					<CardDescription>Clients can add this URL as a Claude Code marketplace source.</CardDescription>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex gap-2">
						<Input readOnly value={manifestURL} data-testid="marketplace-manifest-url" />
					</div>
					{configData?.marketplace && (
						<div className="grid gap-3 md:grid-cols-3">
							<div>
								<Label>Name</Label>
								<Input
									value={configData.marketplace.name}
									onChange={(e) =>
										updateConfig({
											...configData.marketplace,
											name: e.target.value,
										}).unwrap().then(() => toast.success("Marketplace config updated"))
									}
									data-testid="marketplace-config-name"
								/>
							</div>
							<div>
								<Label>Owner</Label>
								<Input
									value={configData.marketplace.owner?.name ?? ""}
									onChange={(e) =>
										updateConfig({
											...configData.marketplace,
											owner: { ...configData.marketplace.owner, name: e.target.value },
										}).unwrap().then(() => toast.success("Marketplace config updated"))
									}
									data-testid="marketplace-config-owner"
								/>
							</div>
							<div className="flex items-end gap-2">
								<Switch
									checked={configData.marketplace.public_read ?? true}
									onCheckedChange={(checked) =>
										updateConfig({
											...configData.marketplace,
											public_read: checked,
										}).unwrap().then(() => toast.success("Marketplace config updated"))
									}
									data-testid="marketplace-config-public-read"
								/>
								<Label>Public catalog</Label>
							</div>
						</div>
					)}
				</CardContent>
			</Card>

			<div className="flex items-center gap-3">
				<Input
					placeholder="Search items..."
					value={search}
					onChange={(e) => setSearch(e.target.value)}
					data-testid="marketplace-search-input"
				/>
				<Button variant="outline" onClick={() => refetch()}>
					Refresh
				</Button>
			</div>

			<div className="grid gap-3">
				{isLoading && <p className="text-muted-foreground text-sm">Loading marketplace items...</p>}
				{!isLoading && items.length === 0 && (
					<Card>
						<CardContent className="text-muted-foreground py-10 text-center text-sm">
							No marketplace items yet. Create a skill or plugin to get started.
						</CardContent>
					</Card>
				)}
				{items.map((item) => (
					<Card key={item.id} data-testid={`marketplace-item-${item.name}`}>
						<CardContent className="flex items-center justify-between gap-4 py-4">
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<p className="font-medium">{item.name}</p>
									<Badge variant="secondary">{item.item_type}</Badge>
									{!item.enabled && <Badge variant="outline">disabled</Badge>}
								</div>
								<p className="text-muted-foreground mt-1 truncate text-sm">{item.description || "No description"}</p>
								<p className="text-muted-foreground mt-1 text-xs">{item.source}</p>
							</div>
							<div className="flex shrink-0 gap-2">
								<Button variant="outline" onClick={() => setEditor({ mode: "edit", item })}>
									Edit
								</Button>
								<Button
									variant="destructive"
									onClick={async () => {
										try {
											await deleteItem(item.id).unwrap();
											toast.success("Item deleted");
										} catch {
											toast.error("Failed to delete item");
										}
									}}
									data-testid={`marketplace-delete-${item.name}`}
								>
									<Trash2Icon className="h-4 w-4" />
								</Button>
							</div>
						</CardContent>
					</Card>
				))}
			</div>

			<MarketplaceItemDialog
				editor={editor}
				onClose={() => setEditor(null)}
				onSave={async (payload) => {
					try {
						if (editor?.mode === "edit" && editor.item) {
							await updateItem({ id: editor.item.id, body: payload }).unwrap();
							toast.success("Item updated");
						} else {
							await createItem(payload).unwrap();
							toast.success("Item created");
						}
						setEditor(null);
					} catch {
						toast.error("Failed to save item");
					}
				}}
			/>
		</div>
	);
}

function MarketplaceItemDialog({
	editor,
	onClose,
	onSave,
}: {
	editor: EditorState | null;
	onClose: () => void;
	onSave: (payload: {
		name: string;
		item_type: MarketplaceItemType;
		description?: string;
		version?: string;
		source?: string;
		enabled?: boolean;
		category?: string;
		content?: { skill_md?: string; plugin_json?: Record<string, unknown>; files?: Record<string, string> };
	}) => Promise<void>;
}) {
	const [name, setName] = useState("");
	const [itemType, setItemType] = useState<MarketplaceItemType>("plugin");
	const [description, setDescription] = useState("");
	const [version, setVersion] = useState("1.0.0");
	const [source, setSource] = useState("");
	const [enabled, setEnabled] = useState(true);
	const [contentText, setContentText] = useState("");

	const open = editor !== null;
	const isEdit = editor?.mode === "edit";

	useEffect(() => {
		if (!editor) return;
		if (editor.mode === "edit" && editor.item) {
			setName(editor.item.name);
			setItemType(editor.item.item_type);
			setDescription(editor.item.description ?? "");
			setVersion(editor.item.version ?? "1.0.0");
			setSource(editor.item.source ?? "");
			setEnabled(editor.item.enabled);
			setContentText(editor.item.content ? JSON.stringify(editor.item.content, null, 2) : "");
			return;
		}
		setName("");
		setItemType("plugin");
		setDescription("");
		setVersion("1.0.0");
		setSource("");
		setEnabled(true);
		setContentText("");
	}, [editor]);

	const resetAndClose = () => {
		setName("");
		setItemType("plugin");
		setDescription("");
		setVersion("1.0.0");
		setSource("");
		setEnabled(true);
		setContentText("");
		onClose();
	};

	return (
		<Dialog open={open} onOpenChange={(next) => !next && resetAndClose()}>
			<DialogContent className="max-w-2xl" data-testid="marketplace-item-dialog">
				<DialogHeader>
					<DialogTitle>{isEdit ? "Edit marketplace item" : "Create marketplace item"}</DialogTitle>
				</DialogHeader>
				<div className="grid gap-4">
					<div className="grid gap-2">
						<Label>Name</Label>
						<Input value={name} onChange={(e) => setName(e.target.value)} disabled={isEdit} data-testid="marketplace-item-name" />
					</div>
					<div className="grid gap-2">
						<Label>Type</Label>
						<Select value={itemType} onValueChange={(v) => setItemType(v as MarketplaceItemType)} disabled={isEdit}>
							<SelectTrigger data-testid="marketplace-item-type">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								<SelectItem value="plugin">Plugin</SelectItem>
								<SelectItem value="skill">Skill</SelectItem>
							</SelectContent>
						</Select>
					</div>
					<div className="grid gap-2">
						<Label>Description</Label>
						<Textarea value={description} onChange={(e) => setDescription(e.target.value)} data-testid="marketplace-item-description" />
					</div>
					<div className="grid grid-cols-2 gap-3">
						<div className="grid gap-2">
							<Label>Version</Label>
							<Input value={version} onChange={(e) => setVersion(e.target.value)} />
						</div>
						<div className="grid gap-2">
							<Label>Source path</Label>
							<Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="./marketplace/plugins/name" />
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Checkbox checked={enabled} onCheckedChange={(v) => setEnabled(Boolean(v))} />
						<Label>Enabled</Label>
					</div>
					<div className="grid gap-2">
						<Label>Content bundle (JSON)</Label>
						<Textarea
							className="min-h-40 font-mono text-xs"
							value={contentText}
							onChange={(e) => setContentText(e.target.value)}
							placeholder='{"skill_md":"---\\nname: ...\\n---\\n","files":{}}'
							data-testid="marketplace-item-content"
						/>
					</div>
				</div>
				<DialogFooter>
					<Button variant="outline" onClick={resetAndClose}>
						Cancel
					</Button>
					<Button
						onClick={async () => {
							let content: { skill_md?: string; plugin_json?: Record<string, unknown>; files?: Record<string, string> } | undefined;
							if (contentText.trim()) {
								try {
									content = JSON.parse(contentText);
								} catch {
									toast.error("Invalid content JSON");
									return;
								}
							}
							await onSave({
								name: name.trim(),
								item_type: itemType,
								description: description.trim(),
								version: version.trim(),
								source: source.trim() || undefined,
								enabled,
								content,
							});
							resetAndClose();
						}}
						data-testid="marketplace-item-save"
					>
						Save
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}

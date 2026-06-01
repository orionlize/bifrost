import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alertDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NoPermissionView } from "@/components/noPermissionView";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useIsLocalAdminSession } from "@/hooks/useIsLocalAdminSession";
import { useT } from "@/lib/i18n";
import { getErrorMessage, useGetCoreConfigQuery } from "@/lib/store";
import {
	useCreateGlobalApiKeyMutation,
	useDeleteGlobalApiKeyMutation,
	useListGlobalApiKeysQuery,
	useUpdateGlobalApiKeyMutation,
} from "@/lib/store/apis/globalApiKeysApi";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";
import { Link } from "@tanstack/react-router";
import { Copy, InfoIcon, KeyRound, Loader2, Plus, Power, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function APIKeysView() {
	const t = useT();
	const { data: bifrostConfig, isLoading: configLoading } = useGetCoreConfigQuery({ fromDB: true });
	const { data: authStatus, isLoading: authLoading } = useIsAuthEnabledQuery();
	const isLocalAdmin = useIsLocalAdminSession();
	const { data, isLoading, isFetching } = useListGlobalApiKeysQuery(undefined, { skip: !isLocalAdmin });
	const [createGlobalApiKey, { isLoading: isCreating }] = useCreateGlobalApiKeyMutation();
	const [updateGlobalApiKey, { isLoading: isUpdating }] = useUpdateGlobalApiKeyMutation();
	const [deleteGlobalApiKey, { isLoading: isDeleting }] = useDeleteGlobalApiKeyMutation();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [createdToken, setCreatedToken] = useState<string | null>(null);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const { copy: copyToClipboard } = useCopyToClipboard();

	const isAuthConfigured = useMemo(() => bifrostConfig?.auth_config?.is_enabled, [bifrostConfig]);
	const apiKeys = data?.api_keys ?? [];

	const resetCreateForm = () => {
		setNewKeyName("");
	};

	if (configLoading || authLoading) {
		return <div>{t("common.actions.loading")}</div>;
	}

	if (authStatus?.is_auth_enabled && !isLocalAdmin) {
		return <NoPermissionView entity="API keys" />;
	}

	if (!isAuthConfigured) {
		return (
			<Alert variant="default">
				<InfoIcon className="text-muted h-4 w-4" />
				<AlertDescription>
					<p className="text-md text-muted-foreground">
						{t("apiKeys.authRequired")}{" "}
						<Link to="/workspace/config/security" className="text-md text-primary underline">
							{t("apiKeys.configureSecurity")}
						</Link>
						.
					</p>
				</AlertDescription>
			</Alert>
		);
	}

	const handleCreate = async () => {
		const name = newKeyName.trim();
		if (!name) {
			toast.error(t("apiKeys.nameRequired"));
			return;
		}
		try {
			const result = await createGlobalApiKey({ name }).unwrap();
			setCreatedToken(result.token);
			resetCreateForm();
			setCreateDialogOpen(false);
			toast.success(t("apiKeys.createdSuccess"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const handleToggleActive = async (id: string, isActive: boolean) => {
		try {
			await updateGlobalApiKey({ id, is_active: isActive }).unwrap();
			toast.success(isActive ? t("apiKeys.enabled") : t("apiKeys.disabled"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const handleDelete = async () => {
		if (!deleteTargetId) {
			return;
		}
		try {
			await deleteGlobalApiKey(deleteTargetId).unwrap();
			setDeleteTargetId(null);
			toast.success(t("apiKeys.deleted"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">{t("apiKeys.title")}</h2>
				<p className="text-muted-foreground text-sm">
					{t("apiKeys.description")}{" "}
					<code className="bg-muted rounded px-1 py-0.5 text-xs">Authorization: Bearer &lt;token&gt;</code>.
				</p>
			</div>

			<Alert variant="default">
				<InfoIcon className="text-muted h-4 w-4" />
				<AlertDescription>
					<p className="text-muted-foreground text-sm">{t("apiKeys.infoAlert")}</p>
				</AlertDescription>
			</Alert>

			<div className="overflow-hidden rounded-lg border">
				<div className="flex items-center justify-end border-b px-4 py-3">
					<Button type="button" onClick={() => setCreateDialogOpen(true)} data-testid="global-api-key-create-button">
						<Plus className="h-4 w-4" />
						{t("apiKeys.createApiKey")}
					</Button>
				</div>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("tables.name")}</TableHead>
							<TableHead>{t("apiKeys.prefix")}</TableHead>
							<TableHead>{t("tables.status")}</TableHead>
							<TableHead>{t("apiKeys.created")}</TableHead>
							<TableHead className="w-[120px]">{t("tables.actions")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading || isFetching ? (
							<TableRow>
								<TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
									{t("apiKeys.loading")}
								</TableCell>
							</TableRow>
						) : apiKeys.length === 0 ? (
							<TableRow>
								<TableCell colSpan={5} className="text-muted-foreground py-8 text-center">
									{t("apiKeys.empty")}
								</TableCell>
							</TableRow>
						) : (
							apiKeys.map((apiKey) => (
								<TableRow key={apiKey.id} data-testid={`global-api-key-row-${apiKey.id}`}>
									<TableCell className="font-medium">{apiKey.name}</TableCell>
									<TableCell>
										<code className="text-xs">{apiKey.token_prefix}</code>
									</TableCell>
									<TableCell>
										<Badge variant={apiKey.is_active ? "default" : "secondary"}>
											{apiKey.is_active ? t("shared.status.active") : t("shared.status.disabled")}
										</Badge>
									</TableCell>
									<TableCell>{new Date(apiKey.created_at).toLocaleString()}</TableCell>
									<TableCell>
										<div className="flex items-center gap-1">
											<Button
												type="button"
												variant="ghost"
												size="icon"
												disabled={isUpdating}
												onClick={() => void handleToggleActive(apiKey.id, !apiKey.is_active)}
												title={apiKey.is_active ? t("apiKeys.disableKey") : t("apiKeys.enableKey")}
												data-testid={`global-api-key-toggle-${apiKey.id}`}
											>
												<Power className="h-4 w-4" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => setDeleteTargetId(apiKey.id)}
												title={t("apiKeys.deleteKey")}
												data-testid={`global-api-key-delete-${apiKey.id}`}
											>
												<Trash2 className="h-4 w-4" />
											</Button>
										</div>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>

			<Dialog
				open={createDialogOpen}
				onOpenChange={(open) => {
					setCreateDialogOpen(open);
					if (!open) {
						resetCreateForm();
					}
				}}
			>
				<DialogContent className="sm:max-w-[520px]">
					<DialogHeader>
						<DialogTitle>{t("apiKeys.createTitle")}</DialogTitle>
						<DialogDescription>{t("apiKeys.createDesc")}</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="global-api-key-name">{t("apiKeys.keyName")}</Label>
							<Input
								id="global-api-key-name"
								placeholder={t("apiKeys.keyNamePlaceholder")}
								value={newKeyName}
								onChange={(event) => setNewKeyName(event.target.value)}
								data-testid="global-api-key-name-input"
							/>
						</div>
					</div>
					<DialogFooter>
						<Button
							variant="outline"
							onClick={() => {
								resetCreateForm();
								setCreateDialogOpen(false);
							}}
							disabled={isCreating}
							data-testid="global-api-key-create-cancel"
						>
							{t("common.actions.cancel")}
						</Button>
						<Button
							type="button"
							onClick={() => void handleCreate()}
							disabled={isCreating || newKeyName.trim() === ""}
							data-testid="global-api-key-create-confirm"
						>
							{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.actions.create")}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={createdToken != null} onOpenChange={(open) => !open && setCreatedToken(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							{t("apiKeys.createdDialogTitle")}
						</AlertDialogTitle>
						<AlertDialogDescription>{t("apiKeys.createdDialogDesc")}</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="relative">
						<Button
							variant="ghost"
							size="sm"
							className="absolute top-2 right-2 z-10 h-8"
							onClick={() => {
								if (createdToken) {
									void copyToClipboard(createdToken);
									toast.success(t("apiKeys.copied"));
								}
							}}
						>
							<Copy className="h-4 w-4" />
						</Button>
						<pre className="bg-muted overflow-x-auto rounded p-3 pr-12 font-mono text-sm break-all whitespace-pre-wrap">{createdToken}</pre>
					</div>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setCreatedToken(null)}>{t("apiKeys.done")}</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={deleteTargetId != null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("apiKeys.deleteTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("apiKeys.deleteDesc")}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>{t("common.actions.cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={() => void handleDelete()} disabled={isDeleting}>
							{t("common.actions.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

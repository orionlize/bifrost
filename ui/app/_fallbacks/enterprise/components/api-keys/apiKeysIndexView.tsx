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
import { ComboboxSelect } from "@/components/ui/combobox";
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
	useRotateGlobalApiKeyTokenMutation,
	useUpdateGlobalApiKeyMutation,
} from "@/lib/store/apis/globalApiKeysApi";
import { useListAoneUsersQuery } from "@/lib/store/apis/aoneUsersApi";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";
import { setStoredGlobalApiKey } from "@/lib/utils/globalApiKeyStorage";
import { Link } from "@tanstack/react-router";
import { Copy, InfoIcon, KeyRound, Loader2, Pencil, Plus, Power, RefreshCw, Trash2, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function formatAllowedUsersLabel(allowedUserIds: string[] | undefined, emptyLabel: string): string {
	if (!allowedUserIds || allowedUserIds.length === 0) {
		return emptyLabel;
	}
	return String(allowedUserIds.length);
}

export default function APIKeysView() {
	const t = useT();
	const { data: bifrostConfig, isLoading: configLoading } = useGetCoreConfigQuery({ fromDB: true });
	const { data: authStatus, isLoading: authLoading } = useIsAuthEnabledQuery();
	const isLocalAdmin = useIsLocalAdminSession();
	const { data, isLoading, isFetching } = useListGlobalApiKeysQuery(undefined, { skip: !isLocalAdmin });
	const { data: usersData } = useListAoneUsersQuery({ limit: 500 }, { skip: !isLocalAdmin });
	const [createGlobalApiKey, { isLoading: isCreating }] = useCreateGlobalApiKeyMutation();
	const [updateGlobalApiKey, { isLoading: isUpdating }] = useUpdateGlobalApiKeyMutation();
	const [deleteGlobalApiKey, { isLoading: isDeleting }] = useDeleteGlobalApiKeyMutation();
	const [rotateGlobalApiKeyToken, { isLoading: isRotating }] = useRotateGlobalApiKeyTokenMutation();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [newKeyName, setNewKeyName] = useState("");
	const [newAllowedUserIds, setNewAllowedUserIds] = useState<string[]>([]);
	const [editTargetId, setEditTargetId] = useState<string | null>(null);
	const [editAllowedUserIds, setEditAllowedUserIds] = useState<string[]>([]);
	const [createdToken, setCreatedToken] = useState<string | null>(null);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const { copy: copyToClipboard } = useCopyToClipboard();

	const isAuthConfigured = useMemo(() => bifrostConfig?.auth_config?.is_enabled, [bifrostConfig]);
	const apiKeys = data?.api_keys ?? [];
	const userOptions = useMemo(
		() =>
			(usersData?.users ?? []).map((user) => ({
				value: user.id,
				label: user.display_name || user.name || user.email || user.id,
			})),
		[usersData?.users],
	);

	const resetCreateForm = () => {
		setNewKeyName("");
		setNewAllowedUserIds([]);
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
			const result = await createGlobalApiKey({ name, allowed_user_ids: newAllowedUserIds }).unwrap();
			setCreatedToken(result.token);
			setStoredGlobalApiKey(result.token, result.api_key.id);
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

	const handleOpenEditUsers = (id: string, allowedUserIds?: string[]) => {
		setEditTargetId(id);
		setEditAllowedUserIds(allowedUserIds ?? []);
		setEditDialogOpen(true);
	};

	const handleSaveAllowedUsers = async () => {
		if (!editTargetId) {
			return;
		}
		try {
			await updateGlobalApiKey({ id: editTargetId, allowed_user_ids: editAllowedUserIds }).unwrap();
			setEditDialogOpen(false);
			setEditTargetId(null);
			toast.success(t("apiKeys.allowedUsersUpdated"));
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

	const handleRotateToken = async (id: string) => {
		try {
			const result = await rotateGlobalApiKeyToken(id).unwrap();
			setCreatedToken(result.token);
			setStoredGlobalApiKey(result.token, result.api_key.id);
			toast.success(t("apiKeys.rotatedSuccess"));
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
							<TableHead>{t("apiKeys.allowedUsers")}</TableHead>
							<TableHead>{t("tables.status")}</TableHead>
							<TableHead>{t("apiKeys.created")}</TableHead>
							<TableHead className="w-[140px]">{t("tables.actions")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading || isFetching ? (
							<TableRow>
								<TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
									{t("apiKeys.loading")}
								</TableCell>
							</TableRow>
						) : apiKeys.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
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
										<Badge variant="secondary">
											{formatAllowedUsersLabel(apiKey.allowed_user_ids, t("apiKeys.allUsers"))}
										</Badge>
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
												disabled={isRotating}
												onClick={() => void handleRotateToken(apiKey.id)}
												title={t("apiKeys.rotateKey")}
												data-testid={`global-api-key-rotate-${apiKey.id}`}
											>
												<RefreshCw className="h-4 w-4" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												disabled={isUpdating}
												onClick={() => handleOpenEditUsers(apiKey.id, apiKey.allowed_user_ids)}
												title={t("apiKeys.editAllowedUsers")}
												data-testid={`global-api-key-edit-users-${apiKey.id}`}
											>
												<Pencil className="h-4 w-4" />
											</Button>
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
						<div className="space-y-2">
							<Label className="flex items-center gap-2">
								<Users className="size-4" />
								{t("apiKeys.allowedUsers")}
							</Label>
							<p className="text-muted-foreground text-xs">{t("apiKeys.allowedUsersHint")}</p>
							<div data-testid="global-api-key-create-users">
								<ComboboxSelect
									multiple
									value={newAllowedUserIds}
									onValueChange={setNewAllowedUserIds}
									options={userOptions}
									placeholder={t("apiKeys.allowedUsersPlaceholder")}
								/>
							</div>
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

			<Dialog
				open={editDialogOpen}
				onOpenChange={(open) => {
					setEditDialogOpen(open);
					if (!open) {
						setEditTargetId(null);
					}
				}}
			>
				<DialogContent className="sm:max-w-[520px]">
					<DialogHeader>
						<DialogTitle>{t("apiKeys.editAllowedUsersTitle")}</DialogTitle>
						<DialogDescription>{t("apiKeys.allowedUsersHint")}</DialogDescription>
					</DialogHeader>
					<div data-testid="global-api-key-edit-users">
						<ComboboxSelect
							multiple
							value={editAllowedUserIds}
							onValueChange={setEditAllowedUserIds}
							options={userOptions}
							placeholder={t("apiKeys.allowedUsersPlaceholder")}
						/>
					</div>
					<DialogFooter>
						<Button variant="outline" onClick={() => setEditDialogOpen(false)} disabled={isUpdating}>
							{t("common.actions.cancel")}
						</Button>
						<Button type="button" onClick={() => void handleSaveAllowedUsers()} disabled={isUpdating} data-testid="global-api-key-edit-users-save">
							{isUpdating ? <Loader2 className="h-4 w-4 animate-spin" /> : t("common.actions.save")}
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

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
import { MultiSelect } from "@/components/ui/multiSelect";
import { NoPermissionView } from "@/components/noPermissionView";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useIsLocalAdminSession } from "@/hooks/useIsLocalAdminSession";
import { getErrorMessage, useGetCoreConfigQuery } from "@/lib/store";
import { useListAoneUsersQuery } from "@/lib/store/apis/aoneUsersApi";
import {
	useCreateGlobalApiKeyMutation,
	useDeleteGlobalApiKeyMutation,
	useListGlobalApiKeysQuery,
	useUpdateGlobalApiKeyMutation,
	type GlobalApiKey,
} from "@/lib/store/apis/globalApiKeysApi";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";
import { Link } from "@tanstack/react-router";
import { Copy, InfoIcon, KeyRound, Loader2, Plus, Power, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

function formatAllowedUsers(apiKey: GlobalApiKey, userNameById: Map<string, string>) {
	const ids = apiKey.allowed_user_ids ?? [];
	if (ids.length === 0) {
		return "All users";
	}
	const labels = ids.map((id) => userNameById.get(id) ?? id);
	if (labels.length <= 2) {
		return labels.join(", ");
	}
	return `${labels.slice(0, 2).join(", ")} +${labels.length - 2}`;
}

export default function APIKeysView() {
	const { data: bifrostConfig, isLoading: configLoading } = useGetCoreConfigQuery({ fromDB: true });
	const { data: authStatus, isLoading: authLoading } = useIsAuthEnabledQuery();
	const isLocalAdmin = useIsLocalAdminSession();
	const { data, isLoading, isFetching } = useListGlobalApiKeysQuery(undefined, { skip: !isLocalAdmin });
	const { data: aoneUsersData, isLoading: isLoadingUsers } = useListAoneUsersQuery({ limit: 500 }, { skip: !isLocalAdmin });
	const [createGlobalApiKey, { isLoading: isCreating }] = useCreateGlobalApiKeyMutation();
	const [updateGlobalApiKey, { isLoading: isUpdating }] = useUpdateGlobalApiKeyMutation();
	const [deleteGlobalApiKey, { isLoading: isDeleting }] = useDeleteGlobalApiKeyMutation();
	const [createDialogOpen, setCreateDialogOpen] = useState(false);
	const [createFormKey, setCreateFormKey] = useState(0);
	const [newKeyName, setNewKeyName] = useState("");
	const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
	const [createdToken, setCreatedToken] = useState<string | null>(null);
	const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
	const { copy: copyToClipboard } = useCopyToClipboard();

	const isAuthConfigured = useMemo(() => bifrostConfig?.auth_config?.is_enabled, [bifrostConfig]);
	const apiKeys = data?.api_keys ?? [];
	const userOptions = useMemo(
		() =>
			(aoneUsersData?.users ?? []).map((user) => ({
				label: user.display_name || user.name || user.email || user.id,
				value: user.id,
			})),
		[aoneUsersData?.users],
	);
	const userNameById = useMemo(() => {
		const map = new Map<string, string>();
		for (const user of aoneUsersData?.users ?? []) {
			map.set(user.id, user.display_name || user.name || user.email || user.id);
		}
		return map;
	}, [aoneUsersData?.users]);

	const resetCreateForm = () => {
		setNewKeyName("");
		setSelectedUserIds([]);
	};

	if (configLoading || authLoading) {
		return <div>Loading...</div>;
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
						To create global API keys, enable dashboard authentication first.{" "}
						<Link to="/workspace/config/security" className="text-md text-primary underline">
							Configure Security Settings
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
			toast.error("Please enter a name for the API key.");
			return;
		}
		try {
			const result = await createGlobalApiKey({
				name,
				user_ids: selectedUserIds.length > 0 ? selectedUserIds : undefined,
			}).unwrap();
			setCreatedToken(result.token);
			resetCreateForm();
			setCreateDialogOpen(false);
			toast.success("Global API key created.");
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const handleToggleActive = async (id: string, isActive: boolean) => {
		try {
			await updateGlobalApiKey({ id, is_active: isActive }).unwrap();
			toast.success(isActive ? "API key enabled." : "API key disabled.");
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
			toast.success("API key deleted.");
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	return (
		<div className="mx-auto w-full max-w-5xl space-y-6">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">API Keys</h2>
				<p className="text-muted-foreground text-sm">
					Create global API keys for admin and dashboard API access. Use them as{" "}
					<code className="bg-muted rounded px-1 py-0.5 text-xs">Authorization: Bearer &lt;token&gt;</code>.
				</p>
			</div>

			<Alert variant="default">
				<InfoIcon className="text-muted h-4 w-4" />
				<AlertDescription>
					<p className="text-muted-foreground text-sm">
						Global API keys grant full admin access to dashboard and management APIs when no users are selected. Store them securely — the
						full token is only shown once at creation.
					</p>
				</AlertDescription>
			</Alert>

			<div className="overflow-hidden rounded-lg border">
				<div className="flex items-center justify-end border-b px-4 py-3">
					<Button
						type="button"
						onClick={() => {
							setCreateFormKey((current) => current + 1);
							setCreateDialogOpen(true);
						}}
						data-testid="global-api-key-create-button"
					>
						<Plus className="h-4 w-4" />
						Create API Key
					</Button>
				</div>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>Name</TableHead>
							<TableHead>Prefix</TableHead>
							<TableHead>Users</TableHead>
							<TableHead>Status</TableHead>
							<TableHead>Created</TableHead>
							<TableHead className="w-[120px]">Actions</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading || isFetching ? (
							<TableRow>
								<TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
									Loading API keys...
								</TableCell>
							</TableRow>
						) : apiKeys.length === 0 ? (
							<TableRow>
								<TableCell colSpan={6} className="text-muted-foreground py-8 text-center">
									No global API keys yet.
								</TableCell>
							</TableRow>
						) : (
							apiKeys.map((apiKey) => (
								<TableRow key={apiKey.id} data-testid={`global-api-key-row-${apiKey.id}`}>
									<TableCell className="font-medium">{apiKey.name}</TableCell>
									<TableCell>
										<code className="text-xs">{apiKey.token_prefix}</code>
									</TableCell>
									<TableCell className="text-muted-foreground max-w-[220px] truncate text-sm">
										{formatAllowedUsers(apiKey, userNameById)}
									</TableCell>
									<TableCell>
										<Badge variant={apiKey.is_active ? "default" : "secondary"}>{apiKey.is_active ? "Active" : "Disabled"}</Badge>
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
												title={apiKey.is_active ? "Disable API key" : "Enable API key"}
												data-testid={`global-api-key-toggle-${apiKey.id}`}
											>
												<Power className="h-4 w-4" />
											</Button>
											<Button
												type="button"
												variant="ghost"
												size="icon"
												onClick={() => setDeleteTargetId(apiKey.id)}
												title="Delete API key"
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
						<DialogTitle>Create API Key</DialogTitle>
						<DialogDescription>
							Enter a name and optional user scope. The token is shown only once after you confirm creation.
						</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label htmlFor="global-api-key-name">Key name</Label>
							<Input
								id="global-api-key-name"
								placeholder="e.g. CI automation"
								value={newKeyName}
								onChange={(event) => setNewKeyName(event.target.value)}
								data-testid="global-api-key-name-input"
							/>
						</div>
						<div className="space-y-2">
							<Label htmlFor="global-api-key-users">Users</Label>
							<MultiSelect
								key={createFormKey}
								options={userOptions}
								onValueChange={setSelectedUserIds}
								defaultValue={[]}
								placeholder={isLoadingUsers ? "Loading users..." : "All users (no restriction)"}
								variant="inverted"
								maxCount={3}
								modalPopover
								resetOnDefaultValueChange={false}
								disabled={isLoadingUsers}
								className="border-input w-full rounded-sm bg-white shadow-none hover:bg-white dark:bg-white dark:hover:bg-white"
								commandClassName="bg-white dark:bg-white"
								popoverClassName="z-[200] bg-white dark:bg-white"
								data-testid="global-api-key-users-select"
							/>
							<p className="text-muted-foreground text-xs">Leave empty to allow unrestricted access.</p>
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
							Cancel
						</Button>
						<Button
							type="button"
							onClick={() => void handleCreate()}
							disabled={isCreating || newKeyName.trim() === ""}
							data-testid="global-api-key-create-confirm"
						>
							{isCreating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create"}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={createdToken != null} onOpenChange={(open) => !open && setCreatedToken(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle className="flex items-center gap-2">
							<KeyRound className="h-5 w-5" />
							API Key Created
						</AlertDialogTitle>
						<AlertDialogDescription>Copy this token now. You will not be able to see it again.</AlertDialogDescription>
					</AlertDialogHeader>
					<div className="relative">
						<Button
							variant="ghost"
							size="sm"
							className="absolute top-2 right-2 z-10 h-8"
							onClick={() => {
								if (createdToken) {
									void copyToClipboard(createdToken);
									toast.success("Copied to clipboard.");
								}
							}}
						>
							<Copy className="h-4 w-4" />
						</Button>
						<pre className="bg-muted overflow-x-auto rounded p-3 pr-12 font-mono text-sm break-all whitespace-pre-wrap">{createdToken}</pre>
					</div>
					<AlertDialogFooter>
						<AlertDialogAction onClick={() => setCreatedToken(null)}>Done</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<AlertDialog open={deleteTargetId != null} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete API Key</AlertDialogTitle>
						<AlertDialogDescription>
							This permanently removes the key. Applications using it will lose access immediately.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={() => void handleDelete()} disabled={isDeleting}>
							Delete
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
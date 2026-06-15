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
import { Button } from "@/components/ui/button";
import { CardHeader, CardTitle } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getErrorMessage } from "@/lib/store";
import { useDeleteProviderKeyMutation, useGetProviderKeysQuery, useUpdateProviderKeyMutation } from "@/lib/store/apis/providersApi";
import { useT } from "@/lib/i18n";
import { ModelProvider } from "@/lib/types/config";
import { cn } from "@/lib/utils";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { AlertCircle, CheckCircle2, EllipsisIcon, PencilIcon, PlusIcon, TrashIcon } from "lucide-react";
import { ReactNode, useState } from "react";
import { toast } from "sonner";
import AddNewKeySheet from "../dialogs/addNewKeySheet";

interface Props {
	className?: string;
	provider: ModelProvider;
	headerActions?: ReactNode;
	isKeyless?: boolean;
}

function ProviderKeyActionsMenu({
	keyId,
	hasUpdateAccess,
	hasDeleteAccess,
	onEdit,
	onDelete,
}: {
	keyId: string;
	hasUpdateAccess: boolean;
	hasDeleteAccess: boolean;
	onEdit: (keyId: string) => void;
	onDelete: (keyId: string) => void;
}) {
	const t = useT();
	const [isOpen, setIsOpen] = useState(false);

	return (
		<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
			<DropdownMenuTrigger asChild>
				<Button onClick={(e) => e.stopPropagation()} variant="ghost">
					<EllipsisIcon className="h-5 w-5" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				<DropdownMenuItem
					onSelect={(e) => {
						e.preventDefault();
						onEdit(keyId);
						setIsOpen(false);
					}}
					disabled={!hasUpdateAccess}
				>
					<PencilIcon className="mr-1 h-4 w-4" />
					{t("common.actions.edit")}
				</DropdownMenuItem>
				<DropdownMenuItem
					variant="destructive"
					onSelect={(e) => {
						e.preventDefault();
						onDelete(keyId);
						setIsOpen(false);
					}}
					disabled={!hasDeleteAccess}
				>
					<TrashIcon className="mr-1 h-4 w-4" />
					{t("common.actions.delete")}
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

export default function ModelProviderKeysTableView({ provider, className, headerActions, isKeyless }: Props) {
	const t = useT();
	const providerName = provider.name?.toLowerCase() ?? "";
	const isVLLM = providerName === "vllm";
	const isOllamaOrSGL = providerName === "ollama" || providerName === "sgl";
	const entityLabel = isVLLM
		? t("providers.keysTable.entityModel")
		: isOllamaOrSGL
			? t("providers.keysTable.entityServer")
			: t("providers.keysTable.entityKey");
	const entityLabelPlural = isVLLM
		? t("providers.keysTable.entityModels")
		: isOllamaOrSGL
			? t("providers.keysTable.entityServers")
			: t("providers.keysTable.entityKeys");
	const columnLabel = isVLLM ? t("providers.keys.model") : isOllamaOrSGL ? t("providers.keys.server") : t("providers.keys.apiKey");
	const hasUpdateProviderAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const hasDeleteProviderAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Delete);
	const [updateProviderKey, { isLoading: isUpdatingProviderKey }] = useUpdateProviderKeyMutation();
	const [deleteProviderKey, { isLoading: isDeletingProviderKey }] = useDeleteProviderKeyMutation();
	const { data: keys = [] } = useGetProviderKeysQuery(provider.name);
	const isMutatingProviderKey = isUpdatingProviderKey || isDeletingProviderKey;
	const [togglingKeyIds, setTogglingKeyIds] = useState<Set<string>>(new Set());
	const [showAddNewKeyDialog, setShowAddNewKeyDialog] = useState<{ show: boolean; keyId: string | null } | undefined>(undefined);
	const [showDeleteKeyDialog, setShowDeleteKeyDialog] = useState<{ show: boolean; keyId: string } | undefined>(undefined);

	function handleAddKey() {
		setShowAddNewKeyDialog({ show: true, keyId: null });
	}

	return (
		<div className={cn("w-full", className)}>
			{showDeleteKeyDialog && (
				<AlertDialog open={showDeleteKeyDialog.show}>
					<AlertDialogContent onClick={(e) => e.stopPropagation()}>
						<AlertDialogHeader>
							<AlertDialogTitle>{t("providers.keysTable.deleteTitle", { entity: entityLabel })}</AlertDialogTitle>
							<AlertDialogDescription>{t("providers.keysTable.deleteDesc", { entity: entityLabel })}</AlertDialogDescription>
						</AlertDialogHeader>
						<AlertDialogFooter className="pt-4">
							<AlertDialogCancel onClick={() => setShowDeleteKeyDialog(undefined)} disabled={isMutatingProviderKey}>
								{t("common.actions.cancel")}
							</AlertDialogCancel>
							<AlertDialogAction
								disabled={isMutatingProviderKey || !hasDeleteProviderAccess}
								onClick={() => {
									deleteProviderKey({
										provider: provider.name,
										keyId: showDeleteKeyDialog.keyId,
									})
										.unwrap()
										.then(() => {
											toast.success(t("providers.keysTable.deletedSuccess", { entity: entityLabel }));
											setShowDeleteKeyDialog(undefined);
										})
										.catch((err) => {
											toast.error(t("providers.keysTable.deleteFailed", { entity: entityLabel }), {
												description: getErrorMessage(err),
											});
										});
								}}
							>
								{t("common.actions.delete")}
							</AlertDialogAction>
						</AlertDialogFooter>
					</AlertDialogContent>
				</AlertDialog>
			)}
			{showAddNewKeyDialog && (
				<AddNewKeySheet
					show={showAddNewKeyDialog.show}
					onCancel={() => setShowAddNewKeyDialog(undefined)}
					provider={provider}
					keyId={showAddNewKeyDialog.keyId}
					providerName={providerName}
				/>
			)}
			<CardHeader className="mb-4 px-0">
				<CardTitle className="flex items-center justify-between">
					<div className="flex items-center gap-2">{t("providers.keysTable.configured", { entityPlural: entityLabelPlural })}</div>
					<div className="flex items-center gap-2">
						{headerActions}
						{!isKeyless && hasUpdateProviderAccess ? (
							<Button
								disabled={!hasUpdateProviderAccess}
								data-testid="add-key-btn"
								onClick={() => {
									handleAddKey();
								}}
							>
								<PlusIcon className="h-4 w-4" />
								{t("providers.keysTable.addNew", { entity: entityLabel })}
							</Button>
						) : null}
					</div>
				</CardTitle>
			</CardHeader>
			{isKeyless ? (
				<div className="text-muted-foreground flex flex-col items-center justify-center gap-2 rounded-sm border py-10 text-center text-sm">
					<p>{t("providers.keysTable.keylessLine1")}</p>
					<p>{t("providers.keysTable.keylessLine2")}</p>
				</div>
			) : (
				<div className="flex w-full flex-col gap-2 rounded-sm border">
					<Table className="w-full table-fixed" data-testid="keys-table">
						<colgroup>
							<col className="w-[64%]" />
							<col className="w-[12%]" />
							<col className="w-[12%]" />
							<col className="w-[12%]" />
						</colgroup>
						<TableHeader className="w-full">
							<TableRow>
								<TableHead>{columnLabel}</TableHead>
								<TableHead>{t("providers.keysTable.weight")}</TableHead>
								<TableHead>{t("providers.keysTable.enabled")}</TableHead>
								<TableHead className="text-right"></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{keys.length === 0 && (
								<TableRow data-testid="keys-table-empty-state">
									<TableCell colSpan={4} className="py-6 text-center">
										{t("providers.keysTable.noItems", { entityPlural: entityLabelPlural })}
									</TableCell>
								</TableRow>
							)}
							{keys.map((key) => {
								const isKeyEnabled = key.enabled ?? true;
								return (
									<TableRow
										key={key.id}
										data-testid={`key-row-${key.name}`}
										className="text-sm transition-colors hover:bg-white"
										onClick={() => {}}
									>
										<TableCell className="overflow-hidden">
											<div className="flex min-w-0 items-center space-x-2">
												{key.status === "success" && (
													<Tooltip>
														<TooltipTrigger asChild>
															<button
																type="button"
																aria-label={t("providers.keys.keyWorkingAria")}
																data-testid={`key-status-success-${key.name}`}
																className="inline-flex"
															>
																<CheckCircle2 aria-hidden className="h-4 w-4 flex-shrink-0 text-green-600" />
															</button>
														</TooltipTrigger>
														<TooltipContent>{t("providers.keysTable.listModelsWorking")}</TooltipContent>
													</Tooltip>
												)}
												{key.status === "list_models_failed" &&
													(() => {
														const hasEnvVarConfig =
															key.azure_key_config?.endpoint?.from_env ||
															key.vertex_key_config?.project_id?.from_env ||
															key.vertex_key_config?.region?.from_env ||
															key.bedrock_key_config?.region?.from_env ||
															key.vllm_key_config?.url?.from_env ||
															key.value?.from_env;
														const isEnvResolutionError =
															hasEnvVarConfig && key.description && /not set|empty|missing/i.test(key.description);

														return isEnvResolutionError ? (
															<Tooltip>
																<TooltipTrigger asChild>
																	<button
																		type="button"
																		aria-label={t("providers.keys.envVarAria")}
																		data-testid={`key-status-warning-${key.name}`}
																		className="inline-flex"
																	>
																		<AlertCircle aria-hidden className="h-4 w-4 flex-shrink-0 text-orange-500" />
																	</button>
																</TooltipTrigger>
																<TooltipContent className="max-w-xs break-words">
																	{t("providers.keysTable.envVarHint", { description: key.description ?? "" })}
																</TooltipContent>
															</Tooltip>
														) : (
															<Tooltip>
																<TooltipTrigger asChild>
																	<button
																		type="button"
																		aria-label={t("providers.keys.listFailedAria")}
																		data-testid={`key-status-error-${key.name}`}
																		className="inline-flex"
																	>
																		<AlertCircle aria-hidden className="text-destructive h-4 w-4 flex-shrink-0" />
																	</button>
																</TooltipTrigger>
																<TooltipContent className="max-w-xs break-words">
																	{key.description || t("providers.keys.discoveryFailedKey")}
																</TooltipContent>
															</Tooltip>
														);
													})()}
												<span className="truncate font-mono text-sm">{key.name}</span>
											</div>
										</TableCell>
										<TableCell data-testid="key-weight-value">
											<div className="flex items-center space-x-2">
												<span className="font-mono text-sm">{key.weight}</span>
											</div>
										</TableCell>
										<TableCell>
											<Switch
												data-testid="key-enabled-switch"
												checked={isKeyEnabled}
												size="md"
												disabled={!hasUpdateProviderAccess || togglingKeyIds.has(key.id)}
												onAsyncCheckedChange={async (checked) => {
													setTogglingKeyIds((prev) => new Set(prev).add(key.id));
													await updateProviderKey({
														provider: provider.name,
														keyId: key.id,
														key: { ...key, enabled: checked },
													})
														.unwrap()
														.then(() => {
															toast.success(
																checked
																	? t("providers.keysTable.enabledSuccess", { entity: entityLabel })
																	: t("providers.keysTable.disabledSuccess", { entity: entityLabel }),
															);
														})
														.catch((err) => {
															toast.error(t("providers.keysTable.updateFailed", { entity: entityLabel }), {
																description: getErrorMessage(err),
															});
														})
														.finally(() => {
															setTogglingKeyIds((prev) => {
																const next = new Set(prev);
																next.delete(key.id);
																return next;
															});
														});
												}}
											/>
										</TableCell>
										<TableCell className="text-right">
											<div className="flex items-center justify-end space-x-2">
												{hasUpdateProviderAccess || hasDeleteProviderAccess ? (
													<ProviderKeyActionsMenu
														keyId={key.id}
														hasUpdateAccess={hasUpdateProviderAccess}
														hasDeleteAccess={hasDeleteProviderAccess}
														onEdit={(keyId) => setShowAddNewKeyDialog({ show: true, keyId })}
														onDelete={(keyId) => setShowDeleteKeyDialog({ show: true, keyId })}
													/>
												) : null}
											</div>
										</TableCell>
									</TableRow>
								);
							})}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}
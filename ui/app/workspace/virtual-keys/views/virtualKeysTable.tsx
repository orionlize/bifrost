import { RateLimitDisplay } from "@/components/rateLimitDisplay";
import { PIN_SHADOW_RIGHT } from "@/components/table/columnPinning";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ComboboxSelect } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT, type TranslateFn } from "@/lib/i18n";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { resetDurationLabels, supportsCalendarAlignment } from "@/lib/constants/governance";
import {
	getErrorMessage,
	useBulkRotateVirtualKeysMutation,
	useDeleteVirtualKeyMutation,
	useLazyGetVirtualKeysQuery,
	useUpdateVirtualKeyMutation,
} from "@/lib/store";
import { Customer, Team, VirtualKey } from "@/lib/types/governance";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/utils/governance";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import {
	ArrowDown,
	ArrowUp,
	ArrowUpDown,
	ChevronLeft,
	ChevronRight,
	Copy,
	Download,
	Edit,
	Eye,
	EyeOff,
	Loader2,
	MoreHorizontal,
	Plus,
	RotateCcw,
	Search,
	ShieldCheck,
	Trash2,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useVirtualKeyUsage } from "../hooks/useVirtualKeyUsage";
import VirtualKeyDetailSheet from "./virtualKeyDetailsSheet";
import { VirtualKeysEmptyState } from "./virtualKeysEmptyState";
import VirtualKeySheet from "./virtualKeySheet";

const formatResetDuration = (duration: string) => resetDurationLabels[duration] || duration;

type ExportScope = "current_page" | "all";

function virtualKeysToCSV(
	t: TranslateFn,
	vks: VirtualKey[],
	accessProfileNames: Record<number, string> = {},
): string {
	const headers = [
		t("virtualKeys.csvName"),
		t("virtualKeys.csvStatus"),
		t("virtualKeys.csvAssignedTo"),
		t("virtualKeys.csvBudgetLimit"),
		t("virtualKeys.csvBudgetSpent"),
		t("virtualKeys.csvBudgetReset"),
		t("virtualKeys.csvDescription"),
		t("virtualKeys.csvCreatedAt"),
	];
	const rows = vks.map((vk) => {
		const isExhausted =
			vk.budgets?.some((b) => b.current_usage >= b.max_limit) ||
			(vk.rate_limit?.token_current_usage &&
				vk.rate_limit?.token_max_limit &&
				vk.rate_limit.token_current_usage >= vk.rate_limit.token_max_limit) ||
			(vk.rate_limit?.request_current_usage &&
				vk.rate_limit?.request_max_limit &&
				vk.rate_limit.request_current_usage >= vk.rate_limit.request_max_limit);
		const status = vk.is_active
			? isExhausted
				? t("governanceShared.statusExhausted")
				: t("governanceShared.statusActive")
			: t("governanceShared.statusInactive");
		const assignedTo = vk.team
			? t("virtualKeys.statusTeam", { name: vk.team.name })
			: vk.customer
				? t("virtualKeys.statusCustomer", { name: vk.customer.name })
				: "";
		const budgetLimit = vk.budgets?.length ? vk.budgets.map((b) => formatCurrency(b.max_limit)).join("; ") : "";
		const budgetSpent = vk.budgets?.length ? vk.budgets.map((b) => formatCurrency(b.current_usage)).join("; ") : "";
		const budgetReset = vk.budgets?.length ? vk.budgets.map((b) => formatResetDuration(b.reset_duration)).join("; ") : "";
		return [vk.name, status, assignedTo, budgetLimit, budgetSpent, budgetReset, vk.description || "", vk.created_at];
	});
	return [headers, ...rows].map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

function downloadCSV(content: string) {
	const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
	const url = URL.createObjectURL(blob);
	const link = document.createElement("a");
	link.href = url;
	link.download = `virtual-keys-${new Date().toISOString().split("T")[0]}.csv`;
	link.click();
	URL.revokeObjectURL(url);
}

function VKBudgetCell({ vk }: { vk: VirtualKey }) {
	const t = useT();
	const { displayBudgets } = useVirtualKeyUsage(vk);

	if (!displayBudgets || displayBudgets.length === 0) {
		return <span className="text-muted-foreground text-sm">-</span>;
	}

	return (
		<div className="flex flex-col gap-0.5">
			{displayBudgets.map((b, idx) => (
				<div key={idx} className="flex flex-col">
					<span className={cn("font-mono text-sm", b.current_usage >= b.max_limit && "text-red-400")}>
						{formatCurrency(b.current_usage)} / {formatCurrency(b.max_limit)}
					</span>
					<span className="text-muted-foreground text-xs">
						{t("governanceShared.resets", { duration: formatResetDuration(b.reset_duration) })}
						{vk.calendar_aligned && supportsCalendarAlignment(b.reset_duration) && " (calendar)"}
					</span>
				</div>
			))}
		</div>
	);
}

function VKRateLimitCell({ vk }: { vk: VirtualKey }) {
	const { displayRateLimit } = useVirtualKeyUsage(vk);
	return <RateLimitDisplay rateLimits={displayRateLimit} calendarAligned={vk.calendar_aligned} />;
}

function VKActiveSwitch({
	vk,
	hasUpdateAccess,
	onToggle,
}: {
	vk: VirtualKey;
	hasUpdateAccess: boolean;
	onToggle: (vk: VirtualKey, checked: boolean) => Promise<void>;
}) {
	const t = useT();
	const { isManagedByProfile } = useVirtualKeyUsage(vk);

	return (
		<Switch
			checked={vk.is_active}
			disabled={!hasUpdateAccess || isManagedByProfile}
			aria-label={t("virtualKeys.enableDisableAria", {
				action: vk.is_active ? t("virtualKeys.disable") : t("virtualKeys.enable"),
				name: vk.name,
			})}
			data-testid={`vk-active-switch-${vk.name}`}
			title={isManagedByProfile ? t("virtualKeys.managedByProfile") : undefined}
			onAsyncCheckedChange={(checked) => onToggle(vk, checked)}
		/>
	);
}

function VKActionsMenu({
	vk,
	hasUpdateAccess,
	hasDeleteAccess,
	isDeleting,
	onEdit,
	onDelete,
}: {
	vk: VirtualKey;
	hasUpdateAccess: boolean;
	hasDeleteAccess: boolean;
	isDeleting: boolean;
	onEdit: (vk: VirtualKey) => void;
	onDelete: (vkId: string) => void;
}) {
	const t = useT();
	const [isOpen, setIsOpen] = useState(false);
	const { isManagedByProfile } = useVirtualKeyUsage(vk);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const displayName = vk.name.length > 20 ? `${vk.name.slice(0, 20)}...` : vk.name;

	return (
		<>
			<DropdownMenu open={isOpen} onOpenChange={setIsOpen}>
				<DropdownMenuTrigger asChild>
					<Button
						variant="ghost"
						size="icon"
						className="h-8 w-8"
						aria-label={t("virtualKeys.userActionsAria")}
						data-testid={`vk-actions-btn-${vk.name}`}
					>
						<MoreHorizontal className="h-4 w-4" />
					</Button>
				</DropdownMenuTrigger>
				<DropdownMenuContent align="end">
					<DropdownMenuItem
						className="cursor-pointer"
						disabled={!hasUpdateAccess}
						data-testid={`vk-edit-btn-${vk.name}`}
						onSelect={(e) => {
							e.preventDefault();
							onEdit(vk);
							setIsOpen(false);
						}}
					>
						<Edit className="h-4 w-4" />
						{t("governanceShared.edit")}
					</DropdownMenuItem>
					<DropdownMenuItem
						variant="destructive"
						className="cursor-pointer"
						disabled={!hasDeleteAccess || isManagedByProfile}
						data-testid={`vk-delete-btn-${vk.name}`}
						title={isManagedByProfile ? t("virtualKeys.managedNoDelete") : undefined}
						onSelect={(e) => {
							e.preventDefault();
							setDeleteOpen(true);
							setIsOpen(false);
						}}
					>
						<Trash2 className="h-4 w-4" />
						{t("governanceShared.delete")}
					</DropdownMenuItem>
				</DropdownMenuContent>
			</DropdownMenu>
			<AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("virtualKeys.deleteTitle")}</AlertDialogTitle>
						<AlertDialogDescription>{t("virtualKeys.deleteDescriptionShort", { name: displayName })}</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel data-testid={`vk-delete-cancel-${vk.name}`}>{t("governanceShared.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={() => onDelete(vk.id)}
							disabled={isDeleting}
							className="bg-destructive hover:bg-destructive/90"
							data-testid={`vk-delete-confirm-${vk.name}`}
						>
							{isDeleting ? t("governanceShared.deleting") : t("governanceShared.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

interface VirtualKeysTableProps {
	virtualKeys: VirtualKey[];
	totalCount: number;
	teams: Team[];
	customers: Customer[];
	search: string;
	debouncedSearch: string;
	onSearchChange: (value: string) => void;
	customerFilter: string;
	onCustomerFilterChange: (value: string) => void;
	teamFilter: string;
	onTeamFilterChange: (value: string) => void;
	offset: number;
	limit: number;
	onOffsetChange: (offset: number) => void;
	sortBy?: string;
	order?: string;
	onSortChange: (sortBy: string, order: string) => void;
	selectedVkId: string;
	onSelectedVkChange: (id: string, options?: { offset?: number }) => void;
	isFetching?: boolean;
}

export default function VirtualKeysTable({
	virtualKeys,
	totalCount,
	teams,
	customers,
	search,
	debouncedSearch,
	onSearchChange,
	customerFilter,
	onCustomerFilterChange,
	teamFilter,
	onTeamFilterChange,
	offset,
	limit,
	onOffsetChange,
	sortBy,
	order,
	onSortChange,
	selectedVkId,
	onSelectedVkChange,
	isFetching,
}: VirtualKeysTableProps) {
	const t = useT();
	const [showVirtualKeySheet, setShowVirtualKeySheet] = useState(false);
	const [editingVirtualKeyId, setEditingVirtualKeyId] = useState<string | null>(null);
	const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());
	const [showExportDialog, setShowExportDialog] = useState(false);
	const [exportScope, setExportScope] = useState<ExportScope>("current_page");
	const [exportMaxLimit, setExportMaxLimit] = useState("");
	const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
	const [showBulkRotateDialog, setShowBulkRotateDialog] = useState(false);
	const [fetchVirtualKeys, { isFetching: isExporting }] = useLazyGetVirtualKeysQuery();

	// Derive objects from props so they stay in sync with RTK cache updates
	const editingVirtualKey = useMemo(
		() => (editingVirtualKeyId ? (virtualKeys.find((vk) => vk.id === editingVirtualKeyId) ?? null) : null),
		[editingVirtualKeyId, virtualKeys],
	);
	const selectedVirtualKey = useMemo(
		() => (selectedVkId ? (virtualKeys.find((vk) => vk.id === selectedVkId) ?? null) : null),
		[selectedVkId, virtualKeys],
	);

	const hasCreateAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.Create);
	const hasUpdateAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.Update);
	const hasDeleteAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.Delete);

	const [deleteVirtualKey, { isLoading: isDeleting }] = useDeleteVirtualKeyMutation();
	const [updateVirtualKey] = useUpdateVirtualKeyMutation();
	const [bulkRotateVirtualKeys, { isLoading: isBulkRotating }] = useBulkRotateVirtualKeysMutation();

	const visibleIds = useMemo(() => virtualKeys.map((vk) => vk.id), [virtualKeys]);
	const selectedVisibleIds = useMemo(() => visibleIds.filter((id) => selectedIds.has(id)), [selectedIds, visibleIds]);
	const selectedCount = selectedIds.size;
	const allVisibleSelected = visibleIds.length > 0 && selectedVisibleIds.length === visibleIds.length;
	const someVisibleSelected = selectedVisibleIds.length > 0 && selectedVisibleIds.length < visibleIds.length;

	useEffect(() => {
		setSelectedIds((prev) => {
			const visible = new Set(visibleIds);
			const next = new Set([...prev].filter((id) => visible.has(id)));
			return next.size === prev.size ? prev : next;
		});
	}, [visibleIds]);

	const toggleSelectAllVisible = (checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			for (const id of visibleIds) {
				if (checked) {
					next.add(id);
				} else {
					next.delete(id);
				}
			}
			return next;
		});
	};

	const toggleSelectVirtualKey = (vkId: string, checked: boolean) => {
		setSelectedIds((prev) => {
			const next = new Set(prev);
			if (checked) {
				next.add(vkId);
			} else {
				next.delete(vkId);
			}
			return next;
		});
	};

	const handleDelete = async (vkId: string) => {
		try {
			await deleteVirtualKey(vkId).unwrap();
			toast.success(t("virtualKeys.deleted"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const handleToggleActive = async (vk: VirtualKey, checked: boolean) => {
		try {
			await updateVirtualKey({
				vkId: vk.id,
				data: { is_active: checked },
			}).unwrap();
			toast.success(checked ? t("virtualKeys.enabled") : t("virtualKeys.disabled"));
		} catch (error) {
			toast.error(getErrorMessage(error));
			throw error;
		}
	};

	const handleBulkRotate = async () => {
		const ids = Array.from(selectedIds);
		if (ids.length === 0) return;

		try {
			const result = await bulkRotateVirtualKeys({ ids }).unwrap();
			const rotatedIds = new Set(result.virtual_keys.map((vk) => vk.id));
			setSelectedIds((prev) => {
				const next = new Set(prev);
				for (const id of rotatedIds) {
					next.delete(id);
				}
				return next;
			});
			setRevealedKeys((prev) => {
				const next = new Set(prev);
				for (const id of rotatedIds) {
					next.delete(id);
				}
				return next;
			});
			setShowBulkRotateDialog(false);

			const failureCount = result.errors ? Object.keys(result.errors).length : 0;
			if (failureCount > 0) {
				toast.warning(`Rotated ${result.virtual_keys.length} users. ${failureCount} failed.`);
			} else {
				toast.success(`Rotated ${result.virtual_keys.length} users`);
			}
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const handleAddVirtualKey = () => {
		setEditingVirtualKeyId(null);
		setShowVirtualKeySheet(true);
	};

	const handleEditVirtualKey = (vk: VirtualKey) => {
		setEditingVirtualKeyId(vk.id);
		setShowVirtualKeySheet(true);
	};

	const handleVirtualKeySaved = () => {
		setShowVirtualKeySheet(false);
		setEditingVirtualKeyId(null);
	};

	const handleRowClick = (vk: VirtualKey) => {
		onSelectedVkChange(vk.id);
	};

	const handleDetailSheetClose = () => {
		onSelectedVkChange("");
	};

	const selectedVirtualKeyIndex = useMemo(
		() => (selectedVkId ? virtualKeys.findIndex((vk) => vk.id === selectedVkId) : -1),
		[selectedVkId, virtualKeys],
	);

	const handleDetailNavigate = (direction: "prev" | "next") => {
		const currentVkId = selectedVkId;
		if (direction === "prev") {
			if (selectedVirtualKeyIndex > 0) {
				onSelectedVkChange(virtualKeys[selectedVirtualKeyIndex - 1].id);
			} else if (offset > 0) {
				const newOffset = Math.max(0, offset - limit);
				onSelectedVkChange("", { offset: newOffset });
				fetchVirtualKeys({
					limit,
					offset: newOffset,
					search: debouncedSearch || undefined,
					customer_id: customerFilter || undefined,
					team_id: teamFilter || undefined,
					sort_by: (sortBy as "name" | "budget_spent" | "created_at" | "status") || undefined,
					order: (order as "asc" | "desc") || undefined,
				}).then((result) => {
					if (result.data?.virtual_keys?.length) {
						const lastVk = result.data.virtual_keys[result.data.virtual_keys.length - 1];
						onSelectedVkChange(lastVk.id);
					} else if (result.error) {
						onSelectedVkChange(currentVkId, { offset });
					}
				});
			}
		} else {
			if (selectedVirtualKeyIndex >= 0 && selectedVirtualKeyIndex < virtualKeys.length - 1) {
				onSelectedVkChange(virtualKeys[selectedVirtualKeyIndex + 1].id);
			} else if (offset + limit < totalCount) {
				const newOffset = offset + limit;
				onSelectedVkChange("", { offset: newOffset });
				fetchVirtualKeys({
					limit,
					offset: newOffset,
					search: debouncedSearch || undefined,
					customer_id: customerFilter || undefined,
					team_id: teamFilter || undefined,
					sort_by: (sortBy as "name" | "budget_spent" | "created_at" | "status") || undefined,
					order: (order as "asc" | "desc") || undefined,
				}).then((result) => {
					if (result.data?.virtual_keys?.length) {
						const firstVk = result.data.virtual_keys[0];
						onSelectedVkChange(firstVk.id);
					} else if (result.error) {
						onSelectedVkChange(currentVkId, { offset });
					}
				});
			}
		}
	};

	const toggleKeyVisibility = (vkId: string) => {
		const newRevealed = new Set(revealedKeys);
		if (newRevealed.has(vkId)) {
			newRevealed.delete(vkId);
		} else {
			newRevealed.add(vkId);
		}
		setRevealedKeys(newRevealed);
	};

	const maskKey = (key: string, revealed: boolean) => {
		if (revealed) return key;
		return key.substring(0, 8) + "•".repeat(Math.max(0, key.length - 8));
	};

	const { copy: copyToClipboard } = useCopyToClipboard();

	const hasActiveFilters = debouncedSearch || customerFilter || teamFilter;

	const toggleSort = (column: string) => {
		if (sortBy === column) {
			if (order === "asc") {
				onSortChange(column, "desc");
			} else {
				// Clicking again clears sort
				onSortChange("", "");
			}
		} else {
			onSortChange(column, "asc");
		}
	};

	const handleExportCSV = async () => {
		if (exportScope === "current_page") {
			downloadCSV(virtualKeysToCSV(t, virtualKeys));
			toast.success(`Exported ${virtualKeys.length} users`);
			setShowExportDialog(false);
			return;
		}

		// Fetch all with same filters/sort applied
		const maxLimit = exportMaxLimit ? parseInt(exportMaxLimit, 10) : undefined;
		const fetchLimit = maxLimit && maxLimit > 0 ? maxLimit : 10000;

		try {
			const result = await fetchVirtualKeys({
				limit: fetchLimit,
				offset: 0,
				search: debouncedSearch || undefined,
				customer_id: customerFilter || undefined,
				team_id: teamFilter || undefined,
				sort_by: (sortBy as "name" | "budget_spent" | "created_at" | "status") || undefined,
				order: (order as "asc" | "desc") || undefined,
				export: true,
			}).unwrap();

			downloadCSV(virtualKeysToCSV(t, result.virtual_keys));
			toast.success(`Exported ${result.virtual_keys.length} users`);
			setShowExportDialog(false);
		} catch (error) {
			toast.error(`Export failed: ${getErrorMessage(error)}`);
		}
	};

	const openExportDialog = () => {
		setExportScope("current_page");
		setExportMaxLimit("");
		setShowExportDialog(true);
	};

	const SortableHeader = ({ column, label }: { column: string; label: string }) => {
		const isActive = sortBy === column;
		const Icon = isActive ? (order === "desc" ? ArrowDown : ArrowUp) : ArrowUpDown;
		return (
			<Button variant="ghost" onClick={() => toggleSort(column)} data-testid={`vk-sort-${column}`} className="!px-0">
				{label}
				<Icon className={cn("ml-2 h-4 w-4", isActive && "text-foreground")} />
			</Button>
		);
	};

	// True empty state: no VKs at all (not just filtered to zero)
	if (totalCount === 0 && !hasActiveFilters && !isFetching) {
		return (
			<>
				{showVirtualKeySheet && (
					<VirtualKeySheet
						virtualKey={editingVirtualKey}
						teams={teams}
						customers={customers}
						onSave={handleVirtualKeySaved}
						onCancel={() => setShowVirtualKeySheet(false)}
					/>
				)}
				<VirtualKeysEmptyState onAddClick={handleAddVirtualKey} canCreate={hasCreateAccess} />
			</>
		);
	}

	return (
		<>
			{showVirtualKeySheet && (
				<VirtualKeySheet
					virtualKey={editingVirtualKey}
					teams={teams}
					customers={customers}
					onSave={handleVirtualKeySaved}
					onCancel={() => setShowVirtualKeySheet(false)}
				/>
			)}

			{!!selectedVkId && selectedVirtualKey && (
				<VirtualKeyDetailSheet
					virtualKey={selectedVirtualKey}
					onClose={handleDetailSheetClose}
					onNavigate={handleDetailNavigate}
					hasPrev={selectedVirtualKeyIndex > 0 || (selectedVirtualKeyIndex !== -1 && offset > 0)}
					hasNext={selectedVirtualKeyIndex !== -1 && (selectedVirtualKeyIndex < virtualKeys.length - 1 || offset + limit < totalCount)}
				/>
			)}

			{/* Export Dialog */}
			<Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
				<DialogContent className="sm:max-w-[425px]">
					<DialogHeader className="pb-0">
						<DialogTitle>{t("virtualKeys.exportTitle")}</DialogTitle>
						<DialogDescription>{t("virtualKeys.exportDescription")}</DialogDescription>
					</DialogHeader>
					<div className="space-y-4">
						<div className="space-y-2">
							<Label className="text-sm">{t("virtualKeys.exportScope")}</Label>
							<div className="grid grid-cols-2 gap-2" data-testid="vk-export-scope">
								<button
									type="button"
									onClick={() => setExportScope("current_page")}
									className={cn(
										"flex cursor-pointer flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm transition-colors",
										exportScope === "current_page"
											? "border-primary bg-primary/5 text-foreground"
											: "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
									)}
								>
									<span className="font-medium">{t("virtualKeys.currentPage")}</span>
									<span className="text-muted-foreground text-xs">{t("virtualKeys.entriesCount", { count: virtualKeys.length })}</span>
								</button>
								<button
									type="button"
									onClick={() => setExportScope("all")}
									className={cn(
										"flex cursor-pointer flex-col items-center gap-1 rounded-md border px-3 py-3 text-sm transition-colors",
										exportScope === "all"
											? "border-primary bg-primary/5 text-foreground"
											: "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground",
									)}
								>
									<span className="font-medium">{t("virtualKeys.allEntries")}</span>
									<span className="text-muted-foreground text-xs">{t("virtualKeys.totalCount", { count: totalCount })}</span>
								</button>
							</div>
						</div>

						{exportScope === "all" && (
							<div className="space-y-2">
								<Label htmlFor="export-max-limit" className="text-sm">
									{t("virtualKeys.maxEntries")}{" "}
									<span className="text-muted-foreground font-normal">{t("virtualKeys.maxEntriesOptional")}</span>
								</Label>
								<Input
									id="export-max-limit"
									type="number"
									min="1"
									placeholder={t("virtualKeys.maxEntriesPlaceholder", { total: totalCount })}
									value={exportMaxLimit}
									onChange={(e) => setExportMaxLimit(e.target.value)}
									data-testid="vk-export-max-limit"
								/>
							</div>
						)}

						{hasActiveFilters && (
							<p className="text-muted-foreground text-xs">
								{t("virtualKeys.filtersApplied")}{" "}
								{[
									debouncedSearch && t("virtualKeys.filterSearch", { query: debouncedSearch }),
									customerFilter && t("virtualKeys.filterCustomer"),
									teamFilter && t("virtualKeys.filterTeam"),
								]
									.filter(Boolean)
									.join(", ")}
							</p>
						)}

						<div className="text-muted-foreground flex items-center gap-2">
							<ShieldCheck className="h-3.5 w-3.5 shrink-0" />
							<p className="text-xs">{t("virtualKeys.exportTokensExcluded")}</p>
						</div>
					</div>
					<DialogFooter className="pt-0">
						<Button variant="outline" onClick={() => setShowExportDialog(false)} disabled={isExporting}>
							{t("governanceShared.cancel")}
						</Button>
						<Button onClick={handleExportCSV} disabled={isExporting} data-testid="vk-export-confirm-btn">
							{isExporting ? (
								<>
									<Loader2 className="h-4 w-4 animate-spin" />
									{t("virtualKeys.exporting")}
								</>
							) : (
								<>
									<Download className="h-4 w-4" />
									{t("virtualKeys.exportCsv")}
								</>
							)}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			<AlertDialog open={showBulkRotateDialog} onOpenChange={setShowBulkRotateDialog}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("virtualKeys.bulkRotateTitle")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("virtualKeys.bulkRotateDescription", {
								count: selectedCount,
								usersLabel: selectedCount === 1 ? t("virtualKeys.user") : t("virtualKeys.users"),
							})}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel data-testid="vk-bulk-rotate-cancel-btn">{t("governanceShared.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={handleBulkRotate}
							disabled={isBulkRotating || selectedCount === 0}
							data-testid="vk-bulk-rotate-confirm-btn"
						>
							{isBulkRotating ? t("virtualKeys.rotating") : t("virtualKeys.rotateSelected")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<div className="flex min-h-0 w-full grow flex-col overflow-hidden">
				<div className="mb-4 flex shrink-0 items-center justify-between">
					<div>
						<h2 className="text-lg font-semibold">{t("governancePages.users")}</h2>
						<p className="text-muted-foreground text-sm">{t("virtualKeys.description")}</p>
					</div>
					<div className="flex items-center gap-2">
						{selectedCount > 0 && (
							<Button
								variant="outline"
								onClick={() => setShowBulkRotateDialog(true)}
								disabled={!hasUpdateAccess || isBulkRotating}
								data-testid="vk-bulk-rotate-btn"
							>
								<RotateCcw className="h-4 w-4" />
								{t("virtualKeys.rotateSelectedBtn", { count: selectedCount })}
							</Button>
						)}
						<Button variant="outline" onClick={openExportDialog} disabled={virtualKeys.length === 0} data-testid="vk-export-btn">
							<Download className="h-4 w-4" />
							{t("virtualKeys.exportCsv")}
						</Button>
						<Button onClick={handleAddVirtualKey} disabled={!hasCreateAccess} data-testid="create-vk-btn">
							<Plus className="h-4 w-4" />
							{t("virtualKeys.addUser")}
						</Button>
					</div>
				</div>

				{/* Toolbar: Search + Filters */}
				<div className="mb-4 flex shrink-0 items-center gap-3">
					<div className="relative max-w-sm flex-1">
						<Search className="text-muted-foreground absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
						<Input
							aria-label={t("governanceShared.searchUsersAria")}
							placeholder={t("governanceShared.searchByName")}
							value={search}
							onChange={(e) => onSearchChange(e.target.value)}
							className="pl-9"
							data-testid="vk-search-input"
						/>
					</div>
					<ComboboxSelect
						data-testid="vk-customer-filter"
						options={customers.map((c) => ({ label: c.name, value: c.id }))}
						value={customerFilter || null}
						onValueChange={(val) => onCustomerFilterChange(val ?? "")}
						placeholder={t("virtualKeys.filterAllCustomers")}
						className="h-9 w-[180px]"
					/>
					{customerFilter && teamFilter && <span className="text-muted-foreground text-xs font-medium">{t("virtualKeys.filterOr")}</span>}
					<ComboboxSelect
						data-testid="vk-team-filter"
						options={teams.map((t) => ({ label: t.name, value: t.id }))}
						value={teamFilter || null}
						onValueChange={(val) => onTeamFilterChange(val ?? "")}
						placeholder={t("virtualKeys.filterAllTeams")}
						className="h-9 w-[180px]"
					/>
				</div>

				<div className="mb-2 min-h-0 grow overflow-hidden rounded-sm border">
					<Table containerClassName="h-full overflow-auto" className="w-full min-w-[1528px] table-fixed" data-testid="vk-table">
						<TableHeader className="bg-muted sticky top-0 z-20">
							<TableRow>
								<TableHead className="w-[48px]">
									<Checkbox
										checked={allVisibleSelected || (someVisibleSelected ? "indeterminate" : false)}
										onCheckedChange={(checked) => toggleSelectAllVisible(checked === true)}
										aria-label={t("virtualKeys.selectAllAria")}
										data-testid="vk-select-all-checkbox"
									/>
								</TableHead>
								<TableHead className="w-[250px]">
									<SortableHeader column="name" label={t("tables.name")} />
								</TableHead>
								<TableHead className="w-[160px]">{t("virtualKeys.assignedTo")}</TableHead>
								<TableHead className="w-[440px]">{t("tables.key")}</TableHead>
								<TableHead className="w-[200px]">
									<SortableHeader column="budget_spent" label={t("governanceShared.budget")} />
								</TableHead>
								<TableHead className="w-[200px]">{t("virtualKeys.rateLimits")}</TableHead>
								<TableHead className="w-[120px]">
									<SortableHeader column="status" label={t("tables.status")} />
								</TableHead>
								<TableHead className={`bg-muted sticky right-0 z-30 w-[56px] text-right ${PIN_SHADOW_RIGHT}`}></TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{virtualKeys.length === 0 ? (
								<TableRow>
									<TableCell colSpan={8} className="h-24 text-center">
										<span className="text-muted-foreground text-sm">{t("virtualKeys.noMatching")}</span>
									</TableCell>
								</TableRow>
							) : (
								virtualKeys.map((vk) => {
									const isRevealed = revealedKeys.has(vk.id);

									return (
										<TableRow
											key={vk.id}
											data-testid={`vk-row-${vk.name}`}
											className="group hover:bg-muted/50 cursor-pointer transition-colors"
											onClick={() => handleRowClick(vk)}
										>
											<TableCell onClick={(e) => e.stopPropagation()}>
												<Checkbox
													checked={selectedIds.has(vk.id)}
													onCheckedChange={(checked) => toggleSelectVirtualKey(vk.id, checked === true)}
													aria-label={`Select user ${vk.name}`}
													data-testid={`vk-select-checkbox-${vk.name}`}
												/>
											</TableCell>
											<TableCell className="max-w-[200px]">
												<div className="truncate font-medium">{vk.name}</div>
											</TableCell>
											<TableCell>
												{vk.team ? (
													<Badge variant="outline" className="block max-w-full truncate text-left">
														Team: {vk.team.name}
													</Badge>
												) : vk.customer ? (
													<Badge variant="outline" className="block max-w-full truncate text-left">
														Customer: {vk.customer.name}
													</Badge>
												) : (
													<span className="text-muted-foreground max-w-full truncate text-left text-sm">-</span>
												)}
											</TableCell>
											<TableCell onClick={(e) => e.stopPropagation()}>
												<div className="flex items-center gap-2">
													<code className="cursor-default py-1 font-mono text-sm" data-testid="vk-key-value">
														{maskKey(vk.value, isRevealed)}
													</code>
													<div className="flex items-center">
														<Button
															variant="ghost"
															size="sm"
															onClick={() => toggleKeyVisibility(vk.id)}
															data-testid={`vk-visibility-btn-${vk.name}`}
														>
															{isRevealed ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
														</Button>
														<Button
															variant="ghost"
															size="sm"
															onClick={() => copyToClipboard(vk.value)}
															data-testid={`vk-copy-btn-${vk.name}`}
														>
															<Copy className="h-4 w-4" />
														</Button>
													</div>
												</div>
											</TableCell>
											<TableCell>
												<VKBudgetCell vk={vk} />
											</TableCell>
											<TableCell>
												<VKRateLimitCell vk={vk} />
											</TableCell>
											<TableCell onClick={(e) => e.stopPropagation()}>
												<VKActiveSwitch vk={vk} hasUpdateAccess={hasUpdateAccess} onToggle={handleToggleActive} />
											</TableCell>
											<TableCell
												className={`group-hover:bg-muted dark:bg-card dark:group-hover:bg-muted sticky right-0 z-20 bg-white text-right ${PIN_SHADOW_RIGHT}`}
												onClick={(e) => e.stopPropagation()}
											>
												<VKActionsMenu
													vk={vk}
													hasUpdateAccess={hasUpdateAccess}
													hasDeleteAccess={hasDeleteAccess}
													isDeleting={isDeleting}
													onEdit={handleEditVirtualKey}
													onDelete={handleDelete}
												/>
											</TableCell>
										</TableRow>
									);
								})
							)}
						</TableBody>
					</Table>
				</div>

				{/* Pagination */}
				{totalCount > 0 && (
					<div className="flex shrink-0 items-center justify-between text-xs" data-testid="pagination">
						<div className="text-muted-foreground flex items-center gap-2">
							{(offset + 1).toLocaleString()}-{Math.min(offset + limit, totalCount).toLocaleString()} of {totalCount.toLocaleString()}{" "}
							entries
						</div>

						<div className="flex items-center gap-2">
							<Button
								variant="ghost"
								size="sm"
								onClick={() => onOffsetChange(Math.max(0, offset - limit))}
								disabled={offset === 0}
								data-testid="vk-pagination-prev-btn"
								aria-label="Previous page"
							>
								<ChevronLeft className="size-3" />
							</Button>

							<div className="flex items-center gap-1">
								<span>Page</span>
								<span>{Math.floor(offset / limit) + 1}</span>
								<span>of {Math.ceil(totalCount / limit)}</span>
							</div>

							<Button
								variant="ghost"
								size="sm"
								onClick={() => onOffsetChange(offset + limit)}
								disabled={offset + limit >= totalCount}
								data-testid="vk-pagination-next-btn"
								aria-label="Next page"
							>
								<ChevronRight className="size-3" />
							</Button>
						</div>
					</div>
				)}
			</div>
		</>
	);
}
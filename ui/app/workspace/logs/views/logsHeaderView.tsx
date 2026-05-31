import { ColumnConfigDropdown, type ColumnConfigEntry } from "@/components/table";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Command, CommandItem, CommandList } from "@/components/ui/command";
import { DateTimePickerWithRange } from "@/components/ui/datePickerWithRange";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { getErrorMessage, useClearLogsMutation, useRecalculateLogCostsMutation } from "@/lib/store";
import type { LogFilters as LogFiltersType } from "@/lib/types/logs";
import { getRangeForPeriod, TIME_PERIODS } from "@/lib/utils/timeRange";
import { Calculator, MoreVertical, Radio, RefreshCw, Search, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface LogsHeaderViewProps {
	filters: LogFiltersType;
	onFiltersChange: (filters: LogFiltersType) => void;
	fetchLogs: () => Promise<void>;
	fetchStats: () => Promise<void>;
	fetchHistogram: () => Promise<void>;
	loading?: boolean;
	polling: boolean;
	onPollToggle: (enabled: boolean) => void;
	period: string;
	onPeriodChange: (period?: string, from?: Date, to?: Date) => void;
	hasDeleteAccess?: boolean;
	/** Column config for the ColumnConfigDropdown */
	columnEntries: ColumnConfigEntry[];
	columnLabels: Record<string, string>;
	onToggleColumnVisibility: (id: string) => void;
	onResetColumns: () => void;
}

export function LogsHeaderView({
	filters,
	onFiltersChange,
	fetchLogs,
	fetchStats,
	fetchHistogram,
	loading = false,
	polling,
	onPollToggle,
	period,
	onPeriodChange,
	hasDeleteAccess = false,
	columnEntries,
	columnLabels,
	onToggleColumnVisibility,
	onResetColumns,
}: LogsHeaderViewProps) {
	const [openMoreActionsPopover, setOpenMoreActionsPopover] = useState(false);
	const [showClearLogsDialog, setShowClearLogsDialog] = useState(false);
	const [clearAllLogs, setClearAllLogs] = useState(false);
	const [localSearch, setLocalSearch] = useState(filters.content_search || "");
	const searchTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);
	const filtersRef = useRef<LogFiltersType>(filters);
	const [recalculateCosts] = useRecalculateLogCostsMutation();
	const [clearLogs, { isLoading: isClearingLogs }] = useClearLogsMutation();

	const [startTime, setStartTime] = useState<Date | undefined>(filters.start_time ? new Date(filters.start_time) : undefined);
	const [endTime, setEndTime] = useState<Date | undefined>(filters.end_time ? new Date(filters.end_time) : undefined);

	useEffect(() => {
		setStartTime(filters.start_time ? new Date(filters.start_time) : undefined);
		setEndTime(filters.end_time ? new Date(filters.end_time) : undefined);
	}, [filters.start_time, filters.end_time]);

	useEffect(() => {
		filtersRef.current = filters;
	}, [filters]);

	useEffect(() => {
		setLocalSearch(filters.content_search || "");
	}, [filters.content_search]);

	useEffect(() => {
		return () => {
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
		};
	}, []);

	const handleRecalculateCosts = useCallback(async () => {
		try {
			const response = await recalculateCosts({ filters }).unwrap();
			await fetchLogs();
			await fetchStats();
			setOpenMoreActionsPopover(false);
			toast.success(`Recalculated costs for ${response.updated} logs`, {
				description: `${response.updated} logs updated, ${response.skipped} logs skipped, ${response.remaining} logs remaining`,
				duration: 5000,
			});
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	}, [filters, recalculateCosts, fetchLogs, fetchStats]);

	const handleClearLogs = useCallback(async () => {
		try {
			let totalDeleted = 0;
			let remaining = 0;

			do {
				const response = await clearLogs({
					filters: clearAllLogs ? {} : filters,
					clear_all: clearAllLogs,
				}).unwrap();
				totalDeleted += response.deleted;
				remaining = response.remaining;
			} while (remaining > 0);

			await fetchLogs();
			await fetchStats();
			await fetchHistogram();
			setShowClearLogsDialog(false);
			setClearAllLogs(false);
			setOpenMoreActionsPopover(false);
			toast.success(`Deleted ${totalDeleted} logs`, {
				description: clearAllLogs
					? "All LLM logs were removed and the database was compacted."
					: "Logs matching the current filters were removed.",
				duration: 5000,
			});
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	}, [clearAllLogs, clearLogs, fetchHistogram, fetchLogs, fetchStats, filters]);

	const handleSearchChange = useCallback(
		(value: string) => {
			setLocalSearch(value);
			if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
			searchTimeoutRef.current = setTimeout(() => {
				onFiltersChange({ ...filtersRef.current, content_search: value });
			}, 500);
		},
		[onFiltersChange],
	);

	return (
		<>
			<div className="flex grow items-center justify-between space-x-2">
				<Button
					data-testid="logs-refresh-btn"
					variant="outline"
					size="sm"
					className="h-7.5 disabled:opacity-100"
					onClick={() => {
						fetchLogs();
						fetchStats();
						fetchHistogram();
					}}
					disabled={loading}
				>
					<RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
					Refresh
				</Button>
				<Button
					data-testid="logs-live-btn"
					variant={polling ? "default" : "outline"}
					size="sm"
					className="h-7.5"
					onClick={() => onPollToggle(!polling)}
				>
					{polling ? <Radio className="h-4 w-4 animate-pulse" /> : <Radio className="h-4 w-4" />}
					Live
				</Button>
				<div className="border-input flex h-7.5 flex-1 items-center gap-2 rounded-sm border">
					<Search className="mr-0.5 ml-2 size-4" />
					<Input
						type="text"
						className="!h-7 rounded-tl-none rounded-tr-sm rounded-br-sm rounded-bl-none border-none bg-slate-50 shadow-none outline-none focus-visible:ring-0"
						placeholder="Search logs"
						value={localSearch}
						onChange={(e) => handleSearchChange(e.target.value)}
					/>
				</div>

				<DateTimePickerWithRange
					triggerTestId="filter-date-range"
					dateTime={{ from: startTime, to: endTime }}
					predefinedPeriod={period || undefined}
					onDateTimeUpdate={(p) => {
						setStartTime(p.from);
						setEndTime(p.to);
						onPeriodChange(undefined, p.from, p.to);
					}}
					preDefinedPeriods={TIME_PERIODS}
					onPredefinedPeriodChange={(periodValue) => {
						if (!periodValue) return;
						const { from, to } = getRangeForPeriod(periodValue);
						setStartTime(from);
						setEndTime(to);
						onPeriodChange(periodValue, from, to);
					}}
				/>
				<Popover open={openMoreActionsPopover} onOpenChange={setOpenMoreActionsPopover}>
					<PopoverTrigger asChild>
						<Button variant="outline" size="sm" className="h-7.5 w-7.5" data-testid="logs-more-actions-btn">
							<MoreVertical className="h-4 w-4" />
						</Button>
					</PopoverTrigger>
					<PopoverContent className="bg-accent w-[250px] p-2" align="end">
						<Command>
							<CommandList>
								<CommandItem className="hover:bg-accent/50 cursor-pointer" onSelect={handleRecalculateCosts}>
									<Calculator className="text-muted-foreground size-4" />
									<div className="flex flex-col">
										<span className="text-sm">Recalculate costs</span>
										<span className="text-muted-foreground text-xs">For all logs that don't have a cost</span>
									</div>
								</CommandItem>
								{hasDeleteAccess && (
									<CommandItem
										className="hover:bg-accent/50 cursor-pointer"
										data-testid="logs-clear-btn"
										onSelect={() => {
											setOpenMoreActionsPopover(false);
											setShowClearLogsDialog(true);
										}}
									>
										<Trash2 className="text-muted-foreground size-4" />
										<div className="flex flex-col">
											<span className="text-sm">Clear logs</span>
											<span className="text-muted-foreground text-xs">Delete logs matching current filters</span>
										</div>
									</CommandItem>
								)}
							</CommandList>
						</Command>
					</PopoverContent>
				</Popover>
				<ColumnConfigDropdown
					entries={columnEntries}
					labels={columnLabels}
					onToggleVisibility={onToggleColumnVisibility}
					onReset={onResetColumns}
				/>
			</div>

			<AlertDialog
				open={showClearLogsDialog}
				onOpenChange={(open) => {
					setShowClearLogsDialog(open);
					if (!open) {
						setClearAllLogs(false);
					}
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{clearAllLogs ? "Clear all LLM logs?" : "Clear logs matching current filters?"}</AlertDialogTitle>
						<AlertDialogDescription>
							{clearAllLogs
								? "This permanently deletes every LLM log in the database and compacts logs.db to reclaim disk space. This action cannot be undone."
								: "This permanently deletes all LLM logs that match your current time range, sidebar filters, and search query. This action cannot be undone."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<label className="flex cursor-pointer items-start gap-3 px-1 py-2">
						<Checkbox
							checked={clearAllLogs}
							onCheckedChange={(checked) => setClearAllLogs(checked === true)}
							data-testid="logs-clear-all-checkbox"
						/>
						<div className="space-y-1">
							<p className="text-sm leading-none font-medium">Delete all logs</p>
							<p className="text-muted-foreground text-xs">Ignore current filters and remove every LLM log.</p>
						</div>
					</label>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={isClearingLogs}>Cancel</AlertDialogCancel>
						<AlertDialogAction
							data-testid="logs-clear-confirm-btn"
							onClick={handleClearLogs}
							disabled={isClearingLogs}
							className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
						>
							{isClearingLogs ? "Clearing..." : "Clear logs"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

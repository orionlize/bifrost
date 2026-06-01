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
import { CodeEditor } from "@/components/ui/codeEditor";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdownMenu";
import { DottedSeparator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Status, StatusColors, Statuses } from "@/lib/constants/logs";
import { useT } from "@/lib/i18n";
import { useGetMCPLogByIdQuery } from "@/lib/store";
import type { MCPToolLogEntry } from "@/lib/types/logs";
import { downloadAsJson } from "@/lib/utils/browser-download";
import { addMilliseconds, format, isValid } from "date-fns";
import { SheetNavigationButtons } from "@/components/sheetNavigationButtons";
import { useSheetNavigation } from "@/hooks/useSheetNavigation";
import { Download, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

interface MCPLogDetailSheetProps {
	log: MCPToolLogEntry | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
	handleDelete?: (log: MCPToolLogEntry) => Promise<void>;
	onNavigate?: (direction: "prev" | "next") => void;
	hasPrev?: boolean;
	hasNext?: boolean;
}

const LogEntryDetailsView = ({ label, value, className }: { label: string; value: React.ReactNode; className?: string }) => (
	<div className={className}>
		<div className="text-muted-foreground text-xs">{label}</div>
		<div className="text-sm font-medium">{value}</div>
	</div>
);

const BlockHeader = ({ title, icon }: { title: string; icon?: ReactNode }) => {
	return (
		<div className="flex items-center gap-2">
			{icon}
			<div className="text-sm font-medium">{title}</div>
		</div>
	);
};

// Helper function to validate status and return a safe Status value
const getValidatedStatus = (status: string): Status => {
	// Check if status is a valid Status by checking against Statuses array
	if (Statuses.includes(status as Status)) {
		return status as Status;
	}
	// Fallback to "processing" for unknown statuses
	return "processing";
};

export function MCPLogDetailSheet({
	log,
	open,
	onOpenChange,
	handleDelete,
	onNavigate,
	hasPrev = false,
	hasNext = false,
}: MCPLogDetailSheetProps) {
	const t = useT();
	const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);
	const {
		data: fullLog,
		isLoading,
		isError,
	} = useGetMCPLogByIdQuery(log?.id ?? "", {
		skip: !open || !log?.id,
	});

	// Keyboard navigation: arrow up/down to navigate between logs
	const { prev: prevKeys, next: nextKeys } = useSheetNavigation({
		enabled: open,
		hasPrev,
		hasNext,
		onNavigate: (direction) => onNavigate?.(direction),
	});

	if (!log) return null;

	const isFullDataReady = isError || (fullLog?.id === log.id && !isLoading);
	const displayLog = isFullDataReady && fullLog ? fullLog : log;

	if (!isFullDataReady) {
		return (
			<Sheet open={open} onOpenChange={onOpenChange}>
				<SheetContent className="flex w-full flex-col gap-4 overflow-x-hidden p-8 sm:max-w-[60%]">
					<div className="flex h-full items-center justify-center">
						<SheetTitle className="sr-only">{t("mcp.logs.details.loadingSr")}</SheetTitle>
						<Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
					</div>
				</SheetContent>
			</Sheet>
		);
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col gap-4 overflow-x-hidden p-8 sm:max-w-[60%]">
				<SheetHeader className="flex flex-row items-center px-0">
					<div className="flex w-full items-center justify-between">
						<SheetTitle className="flex w-fit items-center gap-2 font-medium">
							{displayLog.id && <p className="text-md max-w-full truncate">{t("mcp.logs.details.requestId")} {displayLog.id}</p>}
							<Badge variant="outline" className={`${StatusColors[getValidatedStatus(displayLog.status)]} uppercase`}>
								{displayLog.status}
							</Badge>
						</SheetTitle>
					</div>
					<SheetNavigationButtons
						hasPrev={hasPrev}
						hasNext={hasNext}
						onNavigate={(dir) => onNavigate?.(dir)}
						prevKeys={prevKeys}
						nextKeys={nextKeys}
						entityLabel={t("mcp.logs.details.entityLabel")}
					/>
					<AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
						<DropdownMenu open={dropdownOpen} onOpenChange={setDropdownOpen}>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" className="size-8" type="button">
									<MoreVertical className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								<DropdownMenuItem
									data-testid="export-log-json"
									onSelect={(e) => {
										e.preventDefault();
										downloadAsJson(displayLog, `mcp-log-${displayLog.id ?? "export"}.json`);
										setDropdownOpen(false);
									}}
								>
									<Download className="h-4 w-4" />
									{t("mcp.logs.details.exportJson")}
								</DropdownMenuItem>
								{handleDelete ? (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											variant="destructive"
											onSelect={(e) => {
												e.preventDefault();
												setDeleteDialogOpen(true);
												setDropdownOpen(false);
											}}
										>
											<Trash2 className="h-4 w-4" />
											{t("mcp.logs.details.deleteLog")}
										</DropdownMenuItem>
									</>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>{t("mcp.logs.details.deleteTitle")}</AlertDialogTitle>
								<AlertDialogDescription>{t("mcp.logs.details.deleteDesc")}</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel>{t("common.actions.cancel")}</AlertDialogCancel>
								<AlertDialogAction
									onClick={async (e) => {
										e.preventDefault();
										if (!handleDelete) return;
										try {
											await handleDelete(displayLog);
											setDeleteDialogOpen(false);
											onOpenChange(false);
										} catch (err) {
											const errorMessage = err instanceof Error ? err.message : t("mcp.logs.details.deleteFailed");
											toast.error(errorMessage);
											// Keep dialog open on error so user can see the error and retry
										}
									}}
								>
									{t("common.actions.delete")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				</SheetHeader>
				<div className="space-y-4 rounded-sm border px-6 py-4">
					<div className="space-y-4">
						<BlockHeader title={t("mcp.logs.details.timings")} />
						<div className="grid w-full grid-cols-3 items-center justify-between gap-4">
							<LogEntryDetailsView
								className="w-full"
								label={t("mcp.logs.details.startTimestamp")}
								value={
									isValid(new Date(displayLog.timestamp))
										? format(new Date(displayLog.timestamp), "yyyy-MM-dd hh:mm:ss aa")
										: t("mcp.logs.details.invalidDate")
								}
							/>
							<LogEntryDetailsView
								className="w-full"
								label={t("mcp.logs.details.endTimestamp")}
								value={
									isValid(new Date(displayLog.timestamp))
										? format(addMilliseconds(new Date(displayLog.timestamp), displayLog.latency || 0), "yyyy-MM-dd hh:mm:ss aa")
										: t("mcp.logs.details.invalidDate")
								}
							/>
							<LogEntryDetailsView
								className="w-full"
								label={t("mcp.logs.details.latency")}
								value={displayLog.latency ? `${displayLog.latency.toFixed(2)}ms` : t("mcp.logs.details.na")}
							/>
						</div>
					</div>
					<DottedSeparator />
					<div className="space-y-4">
						<BlockHeader title={t("mcp.logs.details.requestDetails")} />
						<div className="grid w-full grid-cols-3 items-start justify-between gap-4">
							<LogEntryDetailsView
								className="col-span-2 w-full"
								label={t("mcp.logs.details.toolName")}
								value={<span className="font-mono text-sm">{displayLog.tool_name}</span>}
							/>
							<LogEntryDetailsView
								className="w-full"
								label={t("mcp.logs.details.server")}
								value={
									displayLog.server_label ? (
										<Badge variant="secondary" className="font-mono">
											{displayLog.server_label}
										</Badge>
									) : (
										"-"
									)
								}
							/>
							{displayLog.virtual_key && <LogEntryDetailsView className="w-full" label={t("mcp.logs.details.user")} value={displayLog.virtual_key.name} />}
							{displayLog.llm_request_id && (
								<LogEntryDetailsView
									className="col-span-3 w-full"
									label={t("mcp.logs.details.llmRequestId")}
									value={<span className="font-mono text-xs">{displayLog.llm_request_id}</span>}
								/>
							)}
						</div>
					</div>
				</div>

				{/* Arguments */}
				{displayLog.arguments && (
					<div className="w-full rounded-sm border">
						<div className="border-b px-6 py-2 text-sm font-medium">{t("mcp.logs.details.arguments")}</div>
						<CodeEditor
							className="z-0 w-full"
							shouldAdjustInitialHeight={true}
							maxHeight={250}
							wrap={true}
							code={
								typeof displayLog.arguments === "string"
									? displayLog.arguments
									: JSON.stringify(displayLog.arguments as Record<string, unknown>, null, 2)
							}
							lang="json"
							readonly={true}
							options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
						/>
					</div>
				)}

				{/* Result */}
				{displayLog.result && displayLog.status !== "processing" && (
					<div className="w-full rounded-sm border">
						<div className="border-b px-6 py-2 text-sm font-medium">{t("mcp.logs.details.result")}</div>
						<CodeEditor
							className="z-0 w-full"
							shouldAdjustInitialHeight={true}
							maxHeight={350}
							wrap={true}
							code={typeof displayLog.result === "string" ? displayLog.result : JSON.stringify(displayLog.result, null, 2)}
							lang="json"
							readonly={true}
							options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
						/>
					</div>
				)}

				{/* Metadata */}
				{displayLog.metadata && Object.keys(displayLog.metadata).length > 0 && (
					<div className="space-y-4 rounded-sm border px-6 py-4">
						<BlockHeader title={t("mcp.logs.details.metadata")} />
						<div className="grid w-full grid-cols-3 items-start justify-between gap-4">
							{Object.entries(displayLog.metadata).map(([key, value]) => (
								<LogEntryDetailsView key={key} className="w-full" label={key} value={String(value)} />
							))}
						</div>
					</div>
				)}

				{/* Error Details */}
				{displayLog.error_details && (
					<div className="border-destructive/50 w-full rounded-sm border">
						<div className="border-destructive/50 text-destructive border-b px-6 py-2 text-sm font-medium">{t("mcp.logs.details.errorDetails")}</div>
						<CodeEditor
							className="z-0 w-full"
							shouldAdjustInitialHeight={true}
							maxHeight={250}
							wrap={true}
							code={JSON.stringify(displayLog.error_details, null, 2)}
							lang="json"
							readonly={true}
							options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
						/>
					</div>
				)}
			</SheetContent>
		</Sheet>
	);
}
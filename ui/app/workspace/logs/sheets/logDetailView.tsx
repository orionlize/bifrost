import { formatCost, formatLatency } from "@/app/workspace/dashboard/utils/chartUtils";
import { formatCompactNumber } from "@/lib/utils/numbers";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alertDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/codeEditor";
import {
	DropdownMenu,
	DropdownMenuCheckboxItem,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdownMenu";
import { DottedSeparator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useT, type TranslateFn } from "@/lib/i18n";
import { ProviderIconType, RenderProviderIcon, RoutingEngineUsedIcons } from "@/lib/constants/icons";
import { RequestTypeColors, RequestTypeLabels, RoutingEngineUsedColors, RoutingEngineUsedLabels, Status } from "@/lib/constants/logs";
import { ContentBlock, LogEntry, ResponsesMessage } from "@/lib/types/logs";
import { cn } from "@/lib/utils";
import { isLogBinaryPlaceholder } from "@/lib/utils/logBinaryPlaceholder";
import { downloadAsJson } from "@/lib/utils/browser-download";
import { isJson } from "@/lib/utils/validation";
import { Link } from "@tanstack/react-router";
import { addMilliseconds, format } from "date-fns";
import { AlertCircle, ChevronDown, Clipboard, Download, Loader2, MoreVertical, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import BlockHeader from "../views/blockHeader";
import CollapsibleBox from "../views/collapsibleBox";
import LogChatMessageView from "../views/logChatMessageView";
import LogEntryDetailsView from "../views/logEntryDetailsView";

const formatRealtimeTransport = (value: unknown, t: TranslateFn): string => {
	const transport = String(value ?? "").trim();
	switch (transport.toLowerCase()) {
		case "websocket":
			return t("logDetail.transportLabels.websocket");
		case "webrtc":
			return t("logDetail.transportLabels.webrtc");
		default:
			return transport || t("logDetail.transportLabels.unknown");
	}
};

const getRealtimeTransportBadgeClass = (value: unknown): string => {
	switch (String(value ?? "").toLowerCase()) {
		case "websocket":
			return "border-indigo-300 bg-indigo-50 text-indigo-700 dark:border-indigo-600 dark:bg-indigo-950 dark:text-indigo-300";
		case "webrtc":
			return "border-purple-300 bg-purple-50 text-purple-700 dark:border-purple-600 dark:bg-purple-950 dark:text-purple-300";
		default:
			return "border-slate-300 bg-slate-50 text-slate-700 dark:border-slate-600 dark:bg-slate-950 dark:text-slate-300";
	}
};

const formatRealtimeSource = (value: unknown, t: TranslateFn): string => {
	const source = String(value ?? "").trim();
	switch (source.toLowerCase()) {
		case "ei":
			return t("logDetail.sourceLabels.ei");
		case "lm":
			return t("logDetail.sourceLabels.lm");
		default:
			return source || t("logDetail.sourceLabels.unknown");
	}
};

const extractResponsesText = (msg: ResponsesMessage): string => {
	if (msg.type === "reasoning") {
		const summaryText = (msg.summary ?? [])
			.map((s) => s.text)
			.filter(Boolean)
			.join("\n")
			.trim();
		if (summaryText) return summaryText;
		if (msg.encrypted_content) return msg.encrypted_content;
	}
	if (typeof msg.content === "string") return msg.content;
	if (Array.isArray(msg.content)) {
		return msg.content
			.filter(
				(b: any) =>
					b && b.text && (b.type === "input_text" || b.type === "output_text" || b.type === "reasoning_text" || b.type === "refusal"),
			)
			.map((b: any) => b.text as string)
			.join("\n");
	}
	if (typeof (msg as any).arguments === "string") return (msg as any).arguments as string;
	return "";
};

type ReasoningParts = {
	summaries: string[];
	encrypted?: string;
	signatures: string[];
	contentText?: string;
};

const collectReasoningFromBlocks = (blocks: any[]): { text: string; signatures: string[] } => {
	const texts: string[] = [];
	const signatures: string[] = [];
	for (const b of blocks) {
		if (!b || typeof b !== "object") continue;
		const isReasoningish =
			b.type === "input_text" || b.type === "output_text" || b.type === "reasoning_text" || b.type === "refusal" || !b.type;
		if (isReasoningish && typeof b.text === "string" && b.text.trim()) {
			texts.push(b.text);
		}
		if (typeof b.signature === "string" && b.signature.trim()) {
			signatures.push(b.signature.trim());
		}
	}
	return { text: texts.join("\n"), signatures };
};

const extractReasoningParts = (msg: ResponsesMessage): ReasoningParts => {
	const summaries = (msg.summary ?? []).map((s) => (s?.text ?? "").trim()).filter(Boolean);
	const encryptedRaw = (msg as any).encrypted_content?.trim?.();
	const encrypted = encryptedRaw ? encryptedRaw : undefined;
	const signatures: string[] = [];
	let contentText = "";
	if (typeof msg.content === "string") {
		contentText = msg.content;
	} else if (Array.isArray(msg.content)) {
		const fromContent = collectReasoningFromBlocks(msg.content as any[]);
		contentText = fromContent.text;
		signatures.push(...fromContent.signatures);
	}
	// Some providers stash reasoning under `output` instead of `content`
	const out = (msg as any).output;
	if (out !== undefined) {
		if (typeof out === "string" && out.trim() && !contentText) {
			contentText = out;
		} else if (Array.isArray(out)) {
			const fromOutput = collectReasoningFromBlocks(out as any[]);
			if (!contentText && fromOutput.text) contentText = fromOutput.text;
			signatures.push(...fromOutput.signatures);
		}
	}
	// Defensive: top-level text-bearing fields some variants use
	if (!contentText) {
		const topText =
			(typeof (msg as any).text === "string" && (msg as any).text) ||
			(typeof (msg as any).thinking === "string" && (msg as any).thinking) ||
			"";
		if (topText.trim()) contentText = topText;
	}
	return {
		summaries,
		encrypted,
		signatures,
		contentText: contentText || undefined,
	};
};

const extractChatReasoning = (message: any): string => {
	if (!message) return "";
	if (typeof message.reasoning === "string" && message.reasoning.trim()) {
		return message.reasoning;
	}
	if (Array.isArray(message.reasoning_details)) {
		const parts = (message.reasoning_details as any[])
			.map((d) => (typeof d?.text === "string" ? d.text : (d?.summary ?? "")))
			.map((t: string) => (typeof t === "string" ? t.trim() : ""))
			.filter(Boolean);
		if (parts.length > 0) return parts.join("\n");
	}
	return "";
};

const getResponsesRole = (msg: ResponsesMessage): MessageRole => {
	if (msg.type === "reasoning") return "reasoning";
	if (
		msg.type &&
		(msg.type.endsWith("_call") ||
			msg.type.endsWith("_call_output") ||
			msg.type === "mcp_list_tools" ||
			msg.type === "mcp_approval_request" ||
			msg.type === "mcp_approval_responses")
	) {
		return "tool";
	}
	const r = msg.role;
	if (r === "user") return "user";
	if (r === "assistant") return "assistant";
	if (r === "system" || r === "developer") return "system";
	return "assistant";
};

const isPlainAssistantResponsesMessage = (m: ResponsesMessage): boolean => {
	if (m.type && m.type !== "message") return false;
	return getResponsesRole(m) === "assistant";
};

const isReasoningResponsesMessage = (m: ResponsesMessage): boolean => m.type === "reasoning";

// Streaming providers can emit a single logical assistant turn (or reasoning
// item) as many small messages. Collapse adjacent ones so the UI shows one
// bubble per turn instead of N "1 line" bubbles.
const coalesceResponsesMessages = (msgs: ResponsesMessage[]): ResponsesMessage[] => {
	const out: ResponsesMessage[] = [];
	for (const m of msgs) {
		const last = out[out.length - 1];
		if (last && isPlainAssistantResponsesMessage(last) && isPlainAssistantResponsesMessage(m)) {
			const merged = extractResponsesText(last) + extractResponsesText(m);
			out[out.length - 1] = {
				...last,
				content: [{ type: "output_text", text: merged } as any],
			};
			continue;
		}
		if (last && isReasoningResponsesMessage(last) && isReasoningResponsesMessage(m)) {
			const aSum = last.summary ?? [];
			const bSum = m.summary ?? [];
			const aEnc = (last as any).encrypted_content ?? "";
			const bEnc = (m as any).encrypted_content ?? "";
			const joinedEnc = `${aEnc}${bEnc}`;
			out[out.length - 1] = {
				...last,
				summary: [...aSum, ...bSum],
				encrypted_content: joinedEnc ? joinedEnc : undefined,
			} as ResponsesMessage;
			continue;
		}
		out.push(m);
	}
	return out.filter((m) => {
		if (!isPlainAssistantResponsesMessage(m)) return true;
		return extractResponsesText(m).length > 0;
	});
};

const extractMessageText = (message: any): string => {
	if (!message || message.content == null) return "";
	if (typeof message.content === "string") return message.content;
	if (Array.isArray(message.content)) {
		return message.content
			.filter((block: any) => block && (block.type === "text" || block.type === "input_text" || block.type === "output_text") && block.text)
			.map((block: any) => block.text)
			.join("\n");
	}
	return "";
};

const formatToolChoice = (value: unknown): string => {
	if (typeof value === "string") return value;
	try {
		return JSON.stringify(value);
	} catch {
		return String(value);
	}
};

// Helper to detect passthrough operations
const isPassthroughOperation = (object: string) => object === "passthrough" || object === "passthrough_stream";

// Helper to detect container operations (for hiding irrelevant fields like Model/Tokens)
const isContainerOperation = (object: string) => {
	const containerTypes = [
		"container_create",
		"container_list",
		"container_retrieve",
		"container_delete",
		"container_file_create",
		"container_file_list",
		"container_file_retrieve",
		"container_file_content",
		"container_file_delete",
	];
	return containerTypes.includes(object?.toLowerCase());
};

const statusPillStyles: Record<string, string> = {
	success: "bg-green-50 text-green-700 border-green-200 dark:bg-green-950/40 dark:text-green-400 dark:border-green-900",
	error: "bg-red-50 text-red-700 border-red-200 dark:bg-red-950/40 dark:text-red-400 dark:border-red-900",
	processing: "bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/40 dark:text-blue-400 dark:border-blue-900",
	cancelled: "bg-gray-50 text-gray-700 border-gray-200 dark:bg-gray-900/40 dark:text-gray-400 dark:border-gray-800",
};
const statusDotStyles: Record<string, string> = {
	success: "bg-green-500",
	error: "bg-red-500",
	processing: "bg-blue-500",
	cancelled: "bg-gray-400",
};

function StatusPill({ status }: { status: Status }) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1.5 rounded-sm border px-2 py-0.5 text-[11px] font-semibold uppercase",
				statusPillStyles[status] ?? statusPillStyles.cancelled,
			)}
		>
			<span className={cn("h-1.5 w-1.5 rounded-sm", statusDotStyles[status] ?? statusDotStyles.cancelled)} />
			{status}
		</span>
	);
}

function HeroStat({
	label,
	value,
	sub,
	mono = false,
	valueClass,
	hasRightBorder = false,
}: {
	label: string;
	value: ReactNode;
	sub?: ReactNode;
	mono?: boolean;
	valueClass?: string;
	hasRightBorder?: boolean;
}) {
	return (
		<div className={cn("border-border/70 border-b px-5 py-3 md:border-b-0", hasRightBorder && "md:border-r")}>
			<div className="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">{label}</div>
			<div className={cn("mt-0.5 truncate text-[18px] font-semibold tabular-nums", mono && "font-mono text-[15px]", valueClass)}>
				{value}
			</div>
			{sub ? <div className="text-muted-foreground mt-0.5 truncate text-[11px]">{sub}</div> : null}
		</div>
	);
}

function CopyInlineButton({ text, testId }: { text: string; testId?: string }) {
	const t = useT();
	const { copy } = useCopyToClipboard({ successMessage: t("common.actions.copied") });
	return (
		<button
			type="button"
			onClick={(e) => {
				e.stopPropagation();
				copy(text);
			}}
			className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-6 w-6 items-center justify-center rounded-sm transition"
			aria-label={t("common.actions.copy")}
			data-testid={testId}
		>
			<Clipboard className="h-3.5 w-3.5" />
		</button>
	);
}

type MessageRole = "system" | "user" | "assistant" | "reasoning" | "tool";
const messageToneClass: Record<MessageRole, string> = {
	system: "bg-zinc-50 border-zinc-200 dark:bg-zinc-900/40 dark:border-zinc-800",
	user: "bg-blue-50/60 border-blue-200 dark:bg-blue-950/30 dark:border-blue-900",
	assistant: "bg-white border-zinc-200 dark:bg-zinc-900 dark:border-zinc-800",
	reasoning: "bg-violet-50/70 border-violet-200 dark:bg-violet-950/30 dark:border-violet-900",
	tool: "bg-amber-50/70 border-amber-200 dark:bg-amber-950/30 dark:border-amber-900",
};
const messageDotClass: Record<MessageRole, string> = {
	system: "bg-zinc-400",
	user: "bg-blue-500",
	assistant: "bg-zinc-900 dark:bg-zinc-100",
	reasoning: "bg-violet-500",
	tool: "bg-amber-500",
};
const getMessageRoleLabel = (t: TranslateFn, role: MessageRole): string => {
	switch (role) {
		case "system":
			return t("logDetail.roles.system");
		case "user":
			return t("logDetail.roles.user");
		case "assistant":
			return t("logDetail.roles.assistant");
		case "reasoning":
			return t("logDetail.roles.reasoning");
		case "tool":
			return t("logDetail.roles.toolResult");
	}
};

function EncryptedReveal({ text, label }: { text: string; label: string }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	return (
		<div className="space-y-1">
			<button
				type="button"
				onClick={() => setOpen((o) => !o)}
				className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[10.5px] font-semibold tracking-wider uppercase"
			>
				<ChevronDown className={cn("h-3 w-3 transition-transform", open ? "rotate-180" : "-rotate-90")} />
				{label}
				{!open ? (
					<span className="text-muted-foreground/70 ml-1 font-mono text-[10px] tracking-normal normal-case">{t("logDetail.chars", { count: text.length })}</span>
				) : null}
			</button>
			{open ? <pre className="font-mono text-[12.5px] leading-[1.6] break-all whitespace-pre-wrap">{text}</pre> : null}
		</div>
	);
}

function CollapsibleCode({ text, preview = 3, lang, mono = true }: { text: string; preview?: number; lang?: string; mono?: boolean }) {
	const t = useT();
	const [open, setOpen] = useState(false);
	const lines = text.split("\n");
	const shown = open ? lines : lines.slice(0, preview);
	const hasMore = lines.length > preview;
	const moreCount = lines.length - preview;
	return (
		<>
			{mono ? (
				<pre className="font-mono text-[12.5px] leading-[1.6] break-words whitespace-pre-wrap">{shown.join("\n")}</pre>
			) : (
				<div className="text-[13px] leading-relaxed break-words whitespace-pre-wrap">{shown.join("\n")}</div>
			)}
			{hasMore && (
				<div className="mt-1.5 flex items-center justify-between">
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						className="text-primary inline-flex items-center gap-1 text-[11.5px] font-medium hover:underline"
					>
						{open ? t("logDetail.showLess") : t("logDetail.showMoreLines", { count: moreCount })}
						<ChevronDown className={cn("h-3 w-3 transition-transform", open && "rotate-180")} />
					</button>
					<span className="text-muted-foreground font-mono text-[10.5px]">
						{t(lines.length === 1 ? "logDetail.meta.lines" : "logDetail.meta.linesPlural", { count: lines.length })}{lang ? ` · ${lang}` : ""}
					</span>
				</div>
			)}
		</>
	);
}

function MessageRow({ role, meta, children, last = false }: { role: MessageRole; meta?: string; children: ReactNode; last?: boolean }) {
	const t = useT();
	return (
		<div className="flex gap-3">
			<div className="flex flex-col items-center pt-1.5">
				<span className={cn("h-2 w-2 rounded-sm", messageDotClass[role])} />
				{!last && <div className="bg-border my-1 w-px flex-1" />}
			</div>
			<div className="min-w-0 flex-1 pb-4">
				<div className="mb-1 flex items-center gap-2">
					<span className="text-foreground text-[11.5px] font-semibold">{getMessageRoleLabel(t, role)}</span>
					{meta ? <span className="text-muted-foreground text-[11px]">{meta}</span> : null}
				</div>
				<div className={cn("rounded-sm border p-3 text-[13px] leading-relaxed", messageToneClass[role])}>{children}</div>
			</div>
		</div>
	);
}

interface LogDetailViewProps {
	log: LogEntry | null;
	resolvedSelectedPromptName?: string; // Current prompt name from prompt-repo when `selected_prompt_id` is set; falls back to stored log name
	loading?: boolean;
	handleDelete?: (log: LogEntry) => void;
	onClose?: () => void;
	headerAction?: ReactNode;
	onFilterByParentRequestId?: (parentRequestId: string) => void;
}

export function LogDetailView({
	log,
	resolvedSelectedPromptName,
	loading = false,
	handleDelete,
	onClose,
	headerAction,
	onFilterByParentRequestId,
}: LogDetailViewProps) {
	const t = useT();
	const { copy: copyBody } = useCopyToClipboard({
		successMessage: t("logDetail.copyRequestBodyCopied"),
		errorMessage: t("logDetail.copyRequestBodyFailed"),
	});
	const allRoles: MessageRole[] = ["user", "assistant"];
	const [visibleRoles, setVisibleRoles] = useState<Set<MessageRole>>(new Set(allRoles));

	if (!log) return null;

	const selectedPromptDisplayName = resolvedSelectedPromptName ?? log.selected_prompt_name ?? "";

	const isContainer = isContainerOperation(log.object);
	const isPassthrough = isPassthroughOperation(log.object);
	const isRealtimeTurn = log.object === "realtime.turn";
	const passthroughParams = isPassthrough
		? (log.params as {
				method?: string;
				path?: string;
				raw_query?: string;
				status_code?: number;
			})
		: null;

	const audioFormat = (log.params as any)?.audio?.format || (log.params as any)?.extra_params?.audio?.format || undefined;

	return loading ? (
		<div className="flex h-full items-center justify-center">
			<Loader2 className="text-muted-foreground h-6 w-6 animate-spin" />
		</div>
	) : (
		<>
			{/* Breadcrumb header with actions */}
			<div className="flex items-center justify-between gap-3">
				<div className="text-muted-foreground flex items-center gap-2 text-sm">
					{headerAction}
					<span className="text-foreground font-medium">{t("logDetail.requestDetails")}</span>
				</div>
				{onClose ? (
					<AlertDialog>
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button variant="ghost" className="size-8" type="button" data-testid="logdetails-actions-button">
									<MoreVertical className="h-3 w-3" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end">
								{!isPassthrough && (
									<DropdownMenuItem onClick={() => copyRequestBody(log, copyBody, t)} data-testid="logdetails-copy-request-body-button">
										<Clipboard className="h-4 w-4" />
										{t("logDetail.copyRequestBody")}
									</DropdownMenuItem>
								)}
								<DropdownMenuItem
									onClick={() => downloadAsJson(log, `log-${log.id ?? "export"}.json`)}
									data-testid="logdetails-export-log-button"
								>
									<Download className="h-4 w-4" />
									{t("logDetail.exportJson")}
								</DropdownMenuItem>

								{handleDelete ? (
									<>
										<DropdownMenuSeparator />
										<AlertDialogTrigger asChild>
											<DropdownMenuItem variant="destructive" data-testid="logdetails-delete-item">
												<Trash2 className="h-4 w-4" />
												{t("logDetail.deleteLog")}
											</DropdownMenuItem>
										</AlertDialogTrigger>{" "}
									</>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
						<AlertDialogContent>
							<AlertDialogHeader>
								<AlertDialogTitle>{t("logDetail.deleteTitle")}</AlertDialogTitle>
								<AlertDialogDescription>{t("logDetail.deleteDesc")}</AlertDialogDescription>
							</AlertDialogHeader>
							<AlertDialogFooter>
								<AlertDialogCancel data-testid="logdetails-delete-cancel-button">{t("common.actions.cancel")}</AlertDialogCancel>
								<AlertDialogAction
									data-testid="logdetails-delete-confirm-button"
									onClick={() => {
										if (handleDelete) handleDelete(log);
										onClose();
									}}
								>
									{t("common.actions.delete")}
								</AlertDialogAction>
							</AlertDialogFooter>
						</AlertDialogContent>
					</AlertDialog>
				) : null}
			</div>
			<div className="border-border rounded-sm border">
				<div className="flex items-start justify-between gap-6 px-5 pt-5 pb-4">
					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<StatusPill status={log.status as Status} />
							<Badge
								variant="outline"
								className={cn(
									"rounded-sm px-2 py-0.5 font-medium",
									RequestTypeColors[log.object as keyof typeof RequestTypeColors] ?? "bg-gray-100 text-gray-800",
								)}
							>
								{RequestTypeLabels[log.object as keyof typeof RequestTypeLabels] ?? log.object}
							</Badge>
							{log.routing_rule && (
								<Badge variant="outline" className="bg-card text-muted-foreground rounded-sm px-2 py-0.5 font-normal">
									{t("logDetail.rulePrefix")} {log.routing_rule.name}
								</Badge>
							)}
							{log.metadata?.isAsyncRequest ? (
								<Badge variant="outline" className="rounded-sm bg-teal-100 px-2 py-0.5 text-teal-800 dark:bg-teal-900 dark:text-teal-200">
									{t("logDetail.async")}
								</Badge>
							) : null}
							{log.cache_debug?.hit_type === "direct" ? (
								<Badge
									variant="outline"
									className="rounded-sm bg-indigo-100 px-2 py-0.5 text-indigo-800 dark:bg-indigo-900 dark:text-indigo-200"
								>
									{t("logDetail.directCache")}
								</Badge>
							) : null}
							{log.cache_debug?.hit_type === "semantic" ? (
								<Badge variant="outline" className="rounded-sm bg-rose-100 px-2 py-0.5 text-rose-800 dark:bg-rose-900 dark:text-rose-200">
									{t("logDetail.semanticCache")}
								</Badge>
							) : null}
							{(log.is_large_payload_request || log.is_large_payload_response) && (
								<Badge
									variant="outline"
									className="rounded-sm border-amber-300 bg-amber-50 px-2 py-0.5 text-amber-700 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-400"
								>
									{t("logDetail.largePayload")}
								</Badge>
							)}
							{isRealtimeTurn && log.metadata?.realtime_transport && (
								<Badge
									variant="outline"
									className={cn("rounded-sm px-2 py-0.5 font-medium", getRealtimeTransportBadgeClass(log.metadata.realtime_transport))}
								>
									{formatRealtimeTransport(log.metadata.realtime_transport, t)}
								</Badge>
							)}
							{isRealtimeTurn && log.metadata?.realtime_voice && (
								<Badge
									variant="outline"
									className="rounded-sm border-amber-300 bg-amber-50 px-2 py-0.5 font-medium text-amber-700 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-300"
								>
									{log.metadata.realtime_voice}
								</Badge>
							)}
						</div>
						<div className="mt-3 flex items-center gap-2">
							<div className="text-muted-foreground w-24 shrink-0 text-[10.5px] font-semibold tracking-wider uppercase">{t("logDetail.request")}</div>
							<code className="text-foreground truncate font-mono text-[13px]">{log.id || "—"}</code>
							{log.id ? <CopyInlineButton text={log.id} testId="logdetails-copy-request-id-button" /> : null}
						</div>
						{log.cache_debug?.cache_id && (
							<div className="mt-1 flex items-center gap-2">
								<div className="text-muted-foreground w-24 shrink-0 text-[10.5px] font-semibold tracking-wider uppercase">
									{log.cache_debug.cache_hit ? t("logDetail.cacheHit") : t("logDetail.cacheMiss")}
								</div>
								<code className="text-foreground truncate font-mono text-[13px]">{log.cache_debug.cache_id}</code>
								<CopyInlineButton text={log.cache_debug.cache_id} testId="logdetails-copy-cache-id-button" />
							</div>
						)}
						{log.routing_rule && (
							<div className="mt-1 flex items-center gap-2">
								<div className="text-muted-foreground w-24 shrink-0 text-[10.5px] font-semibold tracking-wider uppercase">{t("logDetail.rule")}</div>
								<span className="text-foreground truncate text-[13px] font-medium">&ldquo;{log.routing_rule.name}&rdquo;</span>
							</div>
						)}
						{log.selected_key && (
							<div className="mt-1 flex items-center gap-2">
								<div className="text-muted-foreground w-24 shrink-0 text-[10.5px] font-semibold tracking-wider uppercase">{t("logDetail.key")}</div>
								<code className="text-foreground truncate font-mono text-[13px]">{log.selected_key.name}</code>
							</div>
						)}
					</div>
					<div className="flex shrink-0 items-center gap-1.5 rounded-sm border bg-white px-2 py-1 text-[12px] font-medium dark:bg-zinc-900">
						<RenderProviderIcon provider={log.provider as ProviderIconType} size="xs" />
						<span className="uppercase">{log.provider}</span>
					</div>
				</div>
				<div className="border-border grid grid-cols-2 border-t md:grid-cols-5">
					<HeroStat
						label={t("logDetail.latency")}
						valueClass="text-primary"
						value={log.latency == null || isNaN(log.latency) ? "—" : formatLatency(log.latency)}
						sub={(() => {
							if (!log.timestamp) return "";
							const start = new Date(log.timestamp);
							if (isNaN(start.getTime())) return "";
							const startStr = format(start, "HH:mm:ss");
							if (log.latency == null || isNaN(log.latency)) return startStr;
							return `${startStr} → ${format(addMilliseconds(start, log.latency), "HH:mm:ss")}`;
						})()}
						hasRightBorder
					/>
					<HeroStat
						label={t("logDetail.model")}
						mono
						value={log.model || "—"}
						sub={log.provider?.toLowerCase() || ""}
						valueClass="whitespace-normal overflow-visible break-all"
						hasRightBorder
					/>
					<HeroStat
						label={t("logDetail.tokensInOut")}
						mono
						value={
							log.token_usage
								? `${formatCompactNumber(log.token_usage.prompt_tokens ?? 0)} / ${formatCompactNumber(log.token_usage.completion_tokens ?? 0)}`
								: "—"
						}
						sub={
							log.token_usage
								? `${t("logDetail.total")} ${formatCompactNumber(log.token_usage.total_tokens ?? 0)}${
										log.token_usage.completion_tokens_details?.reasoning_tokens
											? ` · ${t("logDetail.reasoning")} ${formatCompactNumber(log.token_usage.completion_tokens_details.reasoning_tokens)}`
											: ""
									}`
								: "—"
						}
						hasRightBorder
					/>
					<HeroStat
						label={t("logDetail.cost")}
						value={log.cost != null ? formatCost(log.cost) : "—"}
						sub={
							log.cost != null && log.token_usage?.total_tokens
								? t("logDetail.per1k", { amount: `${((log.cost / log.token_usage.total_tokens) * 1000).toFixed(6)}＄` })
								: ""
						}
						hasRightBorder
					/>
					{isRealtimeTurn ? (
						<HeroStat
							label={t("logDetail.voice")}
							value={log.metadata?.realtime_voice ? String(log.metadata.realtime_voice) : "\u2014"}
							sub={log.metadata?.realtime_transport ? formatRealtimeTransport(log.metadata.realtime_transport, t) : ""}
						/>
					) : (
						<HeroStat
							label={t("logDetail.toolsAvailable")}
							value={(log.params?.tools?.length ?? 0).toString()}
							sub={(log.params as any)?.tool_choice != null ? t("logDetail.choice", { value: formatToolChoice((log.params as any).tool_choice) }) : ""}
						/>
					)}
				</div>
			</div>
			<details className="group bg-card rounded-sm border" open={false}>
				<summary className="hover:bg-muted/30 flex cursor-pointer items-center justify-between px-4 py-2.5 text-sm transition">
					<span className="text-foreground font-medium">{t("logDetail.moreDetails")}</span>
					<span className="text-muted-foreground flex items-center gap-2 text-xs">
						<span className="hidden md:inline">{t("logDetail.moreDetailsHint")}</span>
						<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
					</span>
				</summary>
				<div className="space-y-4 border-t px-6 py-4">
					<div className="space-y-4">
						<BlockHeader title={t("logDetail.timings")} />
						<div className="grid w-full grid-cols-3 items-center justify-between gap-4">
							<LogEntryDetailsView
								className="w-full"
								label={t("logDetail.startTimestamp")}
								value={(() => {
									const d = log.timestamp ? new Date(log.timestamp) : null;
									return d && !isNaN(d.getTime()) ? format(d, "yyyy-MM-dd hh:mm:ss aa") : t("logsMedia.na");
								})()}
							/>
							<LogEntryDetailsView
								className="w-full"
								label={t("logDetail.endTimestamp")}
								value={(() => {
									const d = log.timestamp ? new Date(log.timestamp) : null;
									return d && !isNaN(d.getTime()) ? format(addMilliseconds(d, log.latency || 0), "yyyy-MM-dd hh:mm:ss aa") : "N/A";
								})()}
							/>
							<LogEntryDetailsView
								className="w-full"
								label={t("logDetail.latency")}
								value={log.latency == null || isNaN(log.latency) ? t("logsMedia.na") : <div>{log.latency.toFixed(2)}ms</div>}
							/>
						</div>
					</div>
					<DottedSeparator />
					<div className="space-y-4">
						<BlockHeader title={t("logDetail.requestDetailsSection")} />
						<div className="grid w-full grid-cols-3 items-start justify-between gap-4">
							<LogEntryDetailsView
								className="w-full"
								label={t("logDetail.provider")}
								value={
									<Badge variant="secondary" className="uppercase">
										<RenderProviderIcon provider={log.provider as ProviderIconType} size="sm" />
										{log.provider}
									</Badge>
								}
							/>
							{!isContainer && <LogEntryDetailsView className="w-full" label={t("logDetail.model")} value={log.model} />}
							{!isContainer && log.alias && <LogEntryDetailsView className="w-full" label={t("logDetail.alias")} value={log.alias} />}
							<LogEntryDetailsView
								className="w-full"
								label={t("logDetail.type")}
								value={
									<div
										className={`${RequestTypeColors[log.object as keyof typeof RequestTypeColors] ?? "bg-gray-100 text-gray-800"} rounded-sm px-3 py-1`}
									>
										{RequestTypeLabels[log.object as keyof typeof RequestTypeLabels] ?? log.object ?? "unknown"}
									</div>
								}
							/>
							{log.stop_reason && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.stopReason")}
									value={
										<Badge
											variant="secondary"
											className={cn(
												"uppercase",
												log.stop_reason === "content_filter" || log.stop_reason === "safety" || log.stop_reason === "refusal"
													? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300"
													: log.stop_reason === "length" || log.stop_reason === "max_tokens"
														? "bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-300"
														: "",
											)}
										>
											{log.stop_reason}
										</Badge>
									}
								/>
							)}
							{log.parent_request_id && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.parentRequestId")}
									value={
										onFilterByParentRequestId ? (
											<Tooltip>
												<TooltipTrigger asChild>
													<code
														className="text-primary hover:text-primary/80 block min-w-0 cursor-pointer font-normal break-all underline-offset-2 hover:underline"
														onClick={() => onFilterByParentRequestId(log.parent_request_id as string)}
													>
														{log.parent_request_id}
													</code>
												</TooltipTrigger>
												<TooltipContent sideOffset={6}>{t("logDetail.filterSession")}</TooltipContent>
											</Tooltip>
										) : (
											<code className="block min-w-0 font-normal break-all">{log.parent_request_id}</code>
										)
									}
								/>
							)}
							{log.selected_key && <LogEntryDetailsView className="w-full" label={t("logDetail.selectedKey")} value={log.selected_key.name} />}
							{(log.selected_prompt_id || log.selected_prompt_name || log.selected_prompt_version) && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.selectedPrompt")}
									value={
										<span className="break-words">
											{selectedPromptDisplayName}
											{selectedPromptDisplayName && log.selected_prompt_version ? " · " : ""}
											{log.selected_prompt_version ? <>v{log.selected_prompt_version}</> : null}
										</span>
									}
								/>
							)}
							{log.number_of_retries > 0 && (
								<LogEntryDetailsView className="w-full" label={t("logDetail.numberOfRetries")} value={log.number_of_retries} />
							)}
							{log.team_id && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.team")}
									value={
										<Link
											to="/workspace/logs"
											search={{ team_ids: [log.team_id] }}
											className="text-blue-600 hover:underline dark:text-blue-400"
											data-testid="logdetails-team-link"
										>
											{log.team_name || log.team_id}
										</Link>
									}
								/>
							)}
							{log.customer_id && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.customer")}
									value={
										<Link
											to="/workspace/logs"
											search={{ customer_ids: [log.customer_id] }}
											className="text-blue-600 hover:underline dark:text-blue-400"
											data-testid="logdetails-customer-link"
										>
											{log.customer_name || log.customer_id}
										</Link>
									}
								/>
							)}
							{log.business_unit_id && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.businessUnit")}
									value={
										<Link
											to="/workspace/logs"
											search={{ business_unit_ids: [log.business_unit_id] }}
											className="text-blue-600 hover:underline dark:text-blue-400"
											data-testid="logdetails-business-unit-link"
										>
											{log.business_unit_name || log.business_unit_id}
										</Link>
									}
								/>
							)}
							{log.user_id && (
								<LogEntryDetailsView
									className="w-full"
									label={t("common.user")}
									value={
										<Tooltip>
											<TooltipTrigger asChild>
												<Link
													to="/workspace/logs"
													search={{ user_ids: [log.user_id] }}
													className={`text-primary hover:text-primary/80 block min-w-0 cursor-pointer text-sm font-normal break-all underline-offset-2 hover:underline${log.user_name ? "" : " font-mono"}`}
													data-testid="logdetails-user-link"
												>
													{log.user_name || log.user_id}
												</Link>
											</TooltipTrigger>
											<TooltipContent sideOffset={6}>{log.user_name ? log.user_id : t("logDetail.filterByUser")}</TooltipContent>
										</Tooltip>
									}
								/>
							)}
							{log.fallback_index > 0 && <LogEntryDetailsView className="w-full" label={t("logDetail.fallbackIndex")} value={log.fallback_index} />}
							{log.virtual_key && <LogEntryDetailsView className="w-full" label={t("common.user")} value={log.virtual_key.name} />}
							{log.routing_engines_used && log.routing_engines_used.length > 0 && (
								<LogEntryDetailsView
									className="w-full"
									label={t("logDetail.routingEnginesUsed")}
									value={
										<div className="flex flex-wrap gap-2">
											{log.routing_engines_used.map((engine) => (
												<Badge
													key={engine}
													className={RoutingEngineUsedColors[engine as keyof typeof RoutingEngineUsedColors] ?? "bg-gray-100 text-gray-800"}
												>
													<div className="flex items-center gap-2">
														{RoutingEngineUsedIcons[engine as keyof typeof RoutingEngineUsedIcons]?.()}
														<span>{RoutingEngineUsedLabels[engine as keyof typeof RoutingEngineUsedLabels] ?? engine}</span>
													</div>
												</Badge>
											))}
										</div>
									}
								/>
							)}
							{log.routing_rule && <LogEntryDetailsView className="w-full" label={t("logDetail.routingRule")} value={log.routing_rule.name} />}

							{(log.params as any)?.audio && (
								<>
									{(log.params as any).audio.format && (
										<LogEntryDetailsView className="w-full" label={t("logDetail.audioFormat")} value={(log.params as any).audio.format} />
									)}
									{(log.params as any).audio.voice && (
										<LogEntryDetailsView className="w-full" label={t("logDetail.audioVoice")} value={(log.params as any).audio.voice} />
									)}
								</>
							)}

							{isRealtimeTurn && (
								<>
									{log.metadata?.realtime_session_id && (
										<LogEntryDetailsView
											className="w-full"
											label={t("logDetail.realtimeSession")}
											value={
												<span className="flex items-center gap-1">
													<code className="font-mono text-xs">{log.metadata.realtime_session_id}</code>
													<CopyInlineButton
														text={String(log.metadata.realtime_session_id)}
														testId="logdetails-copy-realtime-session-id-button"
													/>
												</span>
											}
										/>
									)}
									{log.metadata?.provider_session_id && (
										<LogEntryDetailsView
											className="w-full"
											label={t("logDetail.providerSession")}
											value={
												<span className="flex items-center gap-1">
													<code className="font-mono text-xs">{log.metadata.provider_session_id}</code>
													<CopyInlineButton
														text={String(log.metadata.provider_session_id)}
														testId="logdetails-copy-provider-session-id-button"
													/>
												</span>
											}
										/>
									)}
									{log.metadata?.realtime_transport && (
										<LogEntryDetailsView
											className="w-full"
											label={t("logDetail.transport")}
											value={formatRealtimeTransport(log.metadata.realtime_transport, t)}
										/>
									)}
									{log.metadata?.realtime_voice && (
										<LogEntryDetailsView className="w-full" label={t("logDetail.voice")} value={String(log.metadata.realtime_voice)} />
									)}
									{log.metadata?.realtime_source && (
										<LogEntryDetailsView
											className="w-full"
											label={t("logDetail.turnSource")}
											value={formatRealtimeSource(log.metadata.realtime_source, t)}
										/>
									)}
									{log.metadata?.realtime_event_type && (
										<LogEntryDetailsView
											className="w-full"
											label={t("logDetail.triggerEvent")}
											value={<code className="font-mono text-xs">{log.metadata.realtime_event_type}</code>}
										/>
									)}
								</>
							)}

							{passthroughParams && (
								<>
									{passthroughParams.method && <LogEntryDetailsView className="w-full" label={t("logDetail.method")} value={passthroughParams.method} />}
									{passthroughParams.path && <LogEntryDetailsView className="w-full" label={t("logDetail.path")} value={passthroughParams.path} />}
									{passthroughParams.raw_query && (
										<LogEntryDetailsView className="w-full" label={t("logDetail.query")} value={passthroughParams.raw_query} />
									)}
									{(passthroughParams.status_code ?? 0) !== 0 && (
										<LogEntryDetailsView className="w-full" label={t("logDetail.statusCode")} value={passthroughParams.status_code} />
									)}
								</>
							)}

							{log.params &&
								Object.keys(log.params).length > 0 &&
								Object.entries(log.params)
									.filter(([key]) => {
										const passthroughKeys = ["method", "path", "raw_query", "status_code"];
										return (
											key !== "tools" && key !== "instructions" && key !== "audio" && !(isPassthrough && passthroughKeys.includes(key))
										);
									})
									.filter(([_, value]) => typeof value === "boolean" || typeof value === "number" || typeof value === "string")
									.map(([key, value]) => <LogEntryDetailsView key={key} className="w-full" label={key} value={value} />)}
						</div>
					</div>
					{log.status === "success" && !isContainer && !isPassthrough && (
						<>
							<DottedSeparator />
							<div className="space-y-4">
								<BlockHeader title={t("logDetail.tokensSection")} />
								<div className="grid w-full grid-cols-3 items-center justify-between gap-4">
									<LogEntryDetailsView className="w-full" label={t("logDetail.inputTokens")} value={log.token_usage?.prompt_tokens || "-"} />
									<LogEntryDetailsView className="w-full" label={t("logDetail.outputTokens")} value={log.token_usage?.completion_tokens || "-"} />
									<LogEntryDetailsView className="w-full" label={t("logDetail.totalTokens")} value={log.token_usage?.total_tokens || "-"} />
									<LogEntryDetailsView
										className="w-full"
										label={t("logDetail.cost")}
										value={log.cost != null ? `$${parseFloat(log.cost.toFixed(6))}` : "-"}
									/>
									{isRealtimeTurn && (
										<>
											<LogEntryDetailsView
												className="w-full"
												label={t("logDetail.inputTextTokens")}
												value={(log.token_usage?.prompt_tokens ?? 0) - (log.token_usage?.prompt_tokens_details?.audio_tokens ?? 0)}
											/>
											<LogEntryDetailsView
												className="w-full"
												label={t("logDetail.inputAudioTokens")}
												value={log.token_usage?.prompt_tokens_details?.audio_tokens ?? 0}
											/>
											<LogEntryDetailsView
												className="w-full"
												label={t("logDetail.outputTextTokens")}
												value={
													(log.token_usage?.completion_tokens ?? 0) -
													(log.token_usage?.completion_tokens_details?.audio_tokens ?? 0) -
													(log.token_usage?.completion_tokens_details?.reasoning_tokens ?? 0)
												}
											/>
											<LogEntryDetailsView
												className="w-full"
												label={t("logDetail.outputAudioTokens")}
												value={log.token_usage?.completion_tokens_details?.audio_tokens ?? 0}
											/>
											{(log.token_usage?.completion_tokens_details?.reasoning_tokens ?? 0) > 0 && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.reasoningTokens")}
													value={log.token_usage?.completion_tokens_details?.reasoning_tokens ?? 0}
												/>
											)}
										</>
									)}
									{!isRealtimeTurn && log.token_usage?.prompt_tokens_details && (
										<>
											{log.token_usage.prompt_tokens_details.cached_read_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.cacheReadTokens")}
													value={log.token_usage.prompt_tokens_details.cached_read_tokens ?? 0}
												/>
											)}
											{log.token_usage.prompt_tokens_details.cached_write_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.cacheWriteTokens")}
													value={log.token_usage.prompt_tokens_details.cached_write_tokens ?? 0}
												/>
											)}
											{log.token_usage.prompt_tokens_details.audio_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.inputAudioTokens")}
													value={log.token_usage.prompt_tokens_details.audio_tokens || "-"}
												/>
											)}
										</>
									)}
									{!isRealtimeTurn && log.token_usage?.completion_tokens_details && (
										<>
											{log.token_usage.completion_tokens_details.reasoning_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.reasoningTokens")}
													value={log.token_usage.completion_tokens_details.reasoning_tokens || "-"}
												/>
											)}
											{log.token_usage.completion_tokens_details.audio_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.outputAudioTokens")}
													value={log.token_usage.completion_tokens_details.audio_tokens || "-"}
												/>
											)}
											{log.token_usage.completion_tokens_details.accepted_prediction_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.acceptedPredictionTokens")}
													value={log.token_usage.completion_tokens_details.accepted_prediction_tokens || "-"}
												/>
											)}
											{log.token_usage.completion_tokens_details.rejected_prediction_tokens && (
												<LogEntryDetailsView
													className="w-full"
													label={t("logDetail.rejectedPredictionTokens")}
													value={log.token_usage.completion_tokens_details.rejected_prediction_tokens || "-"}
												/>
											)}
										</>
									)}
								</div>
							</div>
							{(() => {
								const params = log.params as any;
								const reasoning = params?.reasoning;
								if (!reasoning || typeof reasoning !== "object" || Object.keys(reasoning).length === 0) {
									return null;
								}
								return (
									<>
										<DottedSeparator />
										<div className="space-y-4">
											<BlockHeader title={t("logDetail.reasoningParams")} />
											<div className="grid w-full grid-cols-3 items-center justify-between gap-4">
												{reasoning.effort && (
													<LogEntryDetailsView
														className="w-full"
														label={t("logDetail.effort")}
														value={
															<Badge variant="secondary" className="uppercase">
																{reasoning.effort}
															</Badge>
														}
													/>
												)}
												{reasoning.summary && (
													<LogEntryDetailsView
														className="w-full"
														label={t("logDetail.summary")}
														value={
															<Badge variant="secondary" className="uppercase">
																{reasoning.summary}
															</Badge>
														}
													/>
												)}
												{reasoning.generate_summary && (
													<LogEntryDetailsView
														className="w-full"
														label={t("logDetail.generateSummary")}
														value={
															<Badge variant="secondary" className="uppercase">
																{reasoning.generate_summary}
															</Badge>
														}
													/>
												)}
												{reasoning.max_tokens && <LogEntryDetailsView className="w-full" label={t("logDetail.maxTokens")} value={reasoning.max_tokens} />}
											</div>
										</div>
									</>
								);
							})()}
							{log.cache_debug && (
								<>
									<DottedSeparator />
									<div className="space-y-4">
										<BlockHeader
											title={t("logDetail.cachingDetails", {
												status: log.cache_debug.cache_hit ? t("logDetail.cacheHitStatus") : t("logDetail.cacheMissStatus"),
											})}
										/>
										<div className="grid w-full grid-cols-3 items-center justify-between gap-4">
											{log.cache_debug.cache_hit ? (
												<>
													<LogEntryDetailsView
														className="w-full"
														label={t("logDetail.cacheType")}
														value={
															<Badge variant="secondary" className="uppercase">
																{log.cache_debug.hit_type}
															</Badge>
														}
													/>
													{log.cache_debug.hit_type === "semantic" && (
														<>
															{log.cache_debug.provider_used && (
																<LogEntryDetailsView
																	className="w-full"
																	label={t("logDetail.embeddingProvider")}
																	value={
																		<Badge variant="secondary" className="uppercase">
																			{log.cache_debug.provider_used}
																		</Badge>
																	}
																/>
															)}
															{log.cache_debug.model_used && (
																<LogEntryDetailsView className="w-full" label={t("logDetail.embeddingModel")} value={log.cache_debug.model_used} />
															)}
															{log.cache_debug.threshold && (
																<LogEntryDetailsView className="w-full" label={t("logDetail.threshold")} value={log.cache_debug.threshold || "-"} />
															)}
															{log.cache_debug.similarity && (
																<LogEntryDetailsView
																	className="w-full"
																	label={t("logDetail.similarityScore")}
																	value={log.cache_debug.similarity?.toFixed(2) || "-"}
																/>
															)}
															{log.cache_debug.input_tokens && (
																<LogEntryDetailsView
																	className="w-full"
																	label={t("logDetail.embeddingInputTokens")}
																	value={log.cache_debug.input_tokens}
																/>
															)}
														</>
													)}
												</>
											) : (
												<>
													{log.cache_debug.provider_used && (
														<LogEntryDetailsView
															className="w-full"
															label={t("logDetail.embeddingProvider")}
															value={
																<Badge variant="secondary" className="uppercase">
																	{log.cache_debug.provider_used}
																</Badge>
															}
														/>
													)}
													{log.cache_debug.model_used && (
														<LogEntryDetailsView className="w-full" label={t("logDetail.embeddingModel")} value={log.cache_debug.model_used} />
													)}
													{log.cache_debug.input_tokens && (
														<LogEntryDetailsView className="w-full" label={t("logDetail.embeddingInputTokens")} value={log.cache_debug.input_tokens} />
													)}
												</>
											)}
										</div>
									</div>
								</>
							)}
							{log.metadata &&
								Object.keys(log.metadata).filter((k) => {
									if (k === "isAsyncRequest") return false;
									if (
										isRealtimeTurn &&
										[
											"realtime_session_id",
											"provider_session_id",
											"realtime_source",
											"realtime_event_type",
											"realtime_transport",
											"realtime_voice",
											"realtime",
										].includes(k)
									)
										return false;
									return true;
								}).length > 0 && (
									<>
										<DottedSeparator />
										<div className="space-y-4">
											<BlockHeader title={t("logDetail.metadata")} />
											<div className="grid w-full grid-cols-3 items-start justify-between gap-4">
												{Object.entries(log.metadata)
													.filter(([key]) => {
														if (key === "isAsyncRequest") return false;
														if (
															isRealtimeTurn &&
															[
																"realtime_session_id",
																"provider_session_id",
																"realtime_source",
																"realtime_event_type",
																"realtime_transport",
																"realtime_voice",
																"realtime",
															].includes(key)
														)
															return false;
														return true;
													})
													.map(([key, value]) => (
														<LogEntryDetailsView key={key} className="w-full" label={key} value={String(value)} />
													))}
											</div>
										</div>
									</>
								)}
						</>
					)}
				</div>
			</details>
			<Tabs key={log.id} defaultValue="messages" className="gap-2">
				<TabsList className="bg-muted/60 h-10 w-fit">
					<TabsTrigger value="messages" className="px-3">
						{t("logDetail.tabs.messages")}
						{log.input_history?.length ? (
							<span className="bg-background text-muted-foreground ml-1.5 rounded-sm border px-2 py-0.5 text-[10px] tabular-nums">
								{log.input_history.length + (log.output_message ? 1 : 0)}
							</span>
						) : null}
					</TabsTrigger>
				</TabsList>

				<TabsContent value="messages" className="space-y-4">
					<div className="flex justify-end">
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<button
									type="button"
									className={cn(
										"inline-flex items-center gap-1.5 rounded-sm border px-2.5 py-1 text-[11.5px] font-medium transition",
										visibleRoles.size < allRoles.length
											? "bg-muted text-foreground border-border"
											: "text-muted-foreground hover:text-foreground border-transparent hover:border-border",
									)}
								>
									{t("logDetail.tabs.messages")}
									{visibleRoles.size < allRoles.length && (
										<span className="bg-primary text-primary-foreground rounded-sm px-1 py-0.5 text-[10px] tabular-nums">
											{visibleRoles.size}/{allRoles.length}
										</span>
									)}
									<ChevronDown className="h-3 w-3" />
								</button>
							</DropdownMenuTrigger>
							<DropdownMenuContent align="end" className="w-48">
								<DropdownMenuCheckboxItem
									checked={visibleRoles.size === allRoles.length}
									onCheckedChange={(checked) => setVisibleRoles(checked ? new Set(allRoles) : new Set())}
								>
									{t("logDetail.showAllMessages")}
								</DropdownMenuCheckboxItem>
								<DropdownMenuSeparator />
								{(["user", "assistant"] as MessageRole[]).map((role) => (
									<DropdownMenuCheckboxItem
										key={role}
										checked={visibleRoles.has(role)}
										onCheckedChange={(checked) =>
											setVisibleRoles((prev) => {
												const next = new Set(prev);
												checked ? next.add(role) : next.delete(role);
												return next;
											})
										}
									>
										<span className={cn("mr-1.5 inline-block h-2 w-2 rounded-sm", messageDotClass[role])} />
										{getMessageRoleLabel(t, role)}
									</DropdownMenuCheckboxItem>
								))}
								<DropdownMenuSeparator />
								<DropdownMenuItem onClick={() => setVisibleRoles(new Set())} className="text-muted-foreground justify-center text-[12px]">
									{t("logDetail.clearAll")}
								</DropdownMenuItem>
							</DropdownMenuContent>
						</DropdownMenu>
					</div>
					{!isPassthrough &&
						((log.input_history && log.input_history.length > 0) ||
							(log.output_message && !log.error_details?.error.message) ||
							log.stop_reason === "refusal" ||
							log.stop_reason === "content_filter" ||
							log.stop_reason === "safety") && (
							<div className="bg-card rounded-sm border p-5">
								{(visibleRoles.size < allRoles.length
									? log.input_history?.filter((m) => {
											if (!m) return false;
											const mainRole = ((m.role as string) || "user") as MessageRole;
											const hasReasoning = !!extractChatReasoning(m);
											return visibleRoles.has(mainRole) || (hasReasoning && visibleRoles.has("reasoning"));
										})
									: log.input_history?.filter(Boolean)
								)?.flatMap((message, index) => {
									const role = ((message.role as string) || "user") as MessageRole;
									const text = extractMessageText(message);
									const reasoningText = extractChatReasoning(message);
									const showAll = visibleRoles.size === allRoles.length;
									const showMain = showAll || visibleRoles.has(role);
									const showReasoning = !!reasoningText && (showAll || visibleRoles.has("reasoning"));
									const hasToolCalls = Array.isArray(message.tool_calls) && message.tool_calls.length > 0;
									const isOverallLast =
										index === (log.input_history?.length ?? 0) - 1 && !log.output_message && !log.error_details?.error.message;
									const lineCount = text ? text.split("\n").length : 0;
									const approxTokens = text ? Math.max(1, Math.round(text.length / 4)) : 0;
									const reasoningTokens = reasoningText ? Math.max(1, Math.round(reasoningText.length / 4)) : 0;
									const meta = text
										? role === "system" || role === "tool"
											? `${lineCount} line${lineCount === 1 ? "" : "s"} · ~${approxTokens} tokens`
											: `${lineCount} line${lineCount === 1 ? "" : "s"}`
										: hasToolCalls
											? `${message.tool_calls!.length} tool call${message.tool_calls!.length === 1 ? "" : "s"}`
											: undefined;
									const usePlainText = role === "user" || role === "assistant";
									const rows: ReactNode[] = [];
									if (showReasoning) {
										rows.push(
											<MessageRow
												key={`${index}-reasoning`}
												role="reasoning"
												meta={`~${reasoningTokens} tokens`}
												last={isOverallLast && !showMain}
											>
												<CollapsibleCode text={reasoningText} preview={3} mono={false} />
											</MessageRow>,
										);
									}
									if (showMain) {
										rows.push(
											<MessageRow key={index} role={role} meta={meta} last={isOverallLast}>
												{text ? (
													usePlainText && isJson(text) ? (
														<CodeEditor
															wrap
															code={(() => {
																try {
																	return JSON.stringify(JSON.parse(text), null, 2);
																} catch {
																	return text;
																}
															})()}
															lang="json"
															readonly
															autoResize
															options={{
																showIndentLines: false,
																disableHover: true,
															}}
														/>
													) : usePlainText ? (
														<CollapsibleCode text={text} preview={3} mono={false} />
													) : (
														<CollapsibleCode text={text} preview={3} lang={role === "system" ? "xml" : undefined} />
													)
												) : (
													<LogChatMessageView message={message} audioFormat={audioFormat} />
												)}
												{text &&
													Array.isArray(message.content) &&
													(message.content as ContentBlock[])
														.filter((b) => b.type === "image_url")
														.map((b, i) => {
															const src = b.image_url?.url;
															if (!src) return null;
															if (isLogBinaryPlaceholder(src)) {
																return (
																	<div key={`${i}-${src}`} className="text-muted-foreground mt-2 font-mono text-xs">
																		{src}
																	</div>
																);
															}
															return <img key={`${i}-${src}`} src={src} alt={t("logDetail.attachedImage")} className="mt-2 max-w-full rounded border" />;
														})}
												{hasToolCalls && text ? (
													<div className="text-muted-foreground mt-2 text-[11px]">
														{message
															.tool_calls!.map((tc) => tc.function?.name)
															.filter(Boolean)
															.join(", ") || `${message.tool_calls!.length} tool call${message.tool_calls!.length === 1 ? "" : "s"}`}
													</div>
												) : null}
											</MessageRow>,
										);
									}
									return rows;
								})}
								{log.output_message &&
									!log.error_details?.error.message &&
									(() => {
										const reasoningText = extractChatReasoning(log.output_message);
										const showReasoning = !!reasoningText && (visibleRoles.size === allRoles.length || visibleRoles.has("reasoning"));
										const showAssistant = visibleRoles.has("assistant");
										if (!showReasoning && !showAssistant) return null;
										const text = extractMessageText(log.output_message);
										const refusalText = log.output_message.refusal;
										const isStopReasonRefusal =
											log.stop_reason === "refusal" || log.stop_reason === "content_filter" || log.stop_reason === "safety";
										const showRefusal = refusalText || (!text && isStopReasonRefusal);
										const lineCount = text ? text.split("\n").length : 0;
										const tokenMeta = log.token_usage?.completion_tokens ? `${log.token_usage.completion_tokens} tokens` : undefined;
										const meta = text
											? tokenMeta
												? `${lineCount} line${lineCount === 1 ? "" : "s"} · ${tokenMeta}`
												: `${lineCount} line${lineCount === 1 ? "" : "s"}`
											: showRefusal
												? "refusal"
												: tokenMeta;
										const reasoningTokens = reasoningText
											? log.token_usage?.completion_tokens_details?.reasoning_tokens || Math.max(1, Math.round(reasoningText.length / 4))
											: 0;
										return (
											<>
												{showReasoning ? (
													<MessageRow role="reasoning" meta={`~${reasoningTokens} tokens`} last={!showAssistant}>
														<CollapsibleCode text={reasoningText} preview={3} mono={false} />
													</MessageRow>
												) : null}
												{showAssistant ? (
													<MessageRow role="assistant" meta={meta} last>
														{showRefusal ? (
															<div className="rounded-sm border border-red-200 bg-red-50/70 p-3 dark:border-red-900 dark:bg-red-950/30">
																<div className="flex items-center gap-2 text-red-700 dark:text-red-400">
																	<AlertCircle className="h-4 w-4 shrink-0" />
																	<span className="text-[12.5px] font-semibold">{t("logDetail.refusal")}</span>
																</div>
																{refusalText && (
																	<div className="mt-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-red-700 dark:text-red-400">
																		{refusalText}
																	</div>
																)}
															</div>
														) : text ? (
															isJson(text) ? (
																<CodeEditor
																	wrap
																	code={(() => {
																		try {
																			return JSON.stringify(JSON.parse(text), null, 2);
																		} catch {
																			return text;
																		}
																	})()}
																	lang="json"
																	readonly
																	autoResize
																	options={{
																		showIndentLines: false,
																		disableHover: true,
																	}}
																/>
															) : (
																<CollapsibleCode text={text} preview={3} mono={false} />
															)
														) : (
															<LogChatMessageView message={log.output_message} audioFormat={audioFormat} />
														)}
													</MessageRow>
												) : null}
											</>
										);
									})()}
								{!log.output_message &&
									!log.error_details?.error.message &&
									(log.stop_reason === "refusal" || log.stop_reason === "content_filter" || log.stop_reason === "safety") && (
										<MessageRow role="assistant" meta="refusal" last>
											<div className="rounded-sm border border-red-200 bg-red-50/70 p-3 dark:border-red-900 dark:bg-red-950/30">
												<div className="flex items-center gap-2 text-red-700 dark:text-red-400">
													<AlertCircle className="h-4 w-4 shrink-0" />
													<span className="text-[12.5px] font-semibold">{t("logDetail.refusal")}</span>
												</div>
											</div>
										</MessageRow>
									)}
							</div>
						)}

					{(() => {
						const rawInput = log.responses_input_history ?? [];
						const inputMsgs =
							visibleRoles.size < allRoles.length ? rawInput.filter((m) => visibleRoles.has(getResponsesRole(m))) : rawInput;
						const rawOutput = log.status !== "processing" && !log.error_details?.error.message ? (log.responses_output ?? []) : [];
						const outputMsgs =
							visibleRoles.size < allRoles.length ? rawOutput.filter((m) => visibleRoles.has(getResponsesRole(m))) : rawOutput;
						const all: ResponsesMessage[] = coalesceResponsesMessages([...inputMsgs, ...outputMsgs]);
						if (all.length === 0) return null;
						return (
							<div className="bg-card rounded-sm border p-5">
								{all.map((msg, index) => {
									const role = getResponsesRole(msg);
									const isLast = index === all.length - 1;
									const reasoningParts = role === "reasoning" ? extractReasoningParts(msg) : null;
									const reasoningHasAny =
										!!reasoningParts &&
										(reasoningParts.summaries.length > 0 ||
											!!reasoningParts.encrypted ||
											!!reasoningParts.contentText ||
											reasoningParts.signatures.length > 0);
									const text = role === "reasoning" ? "" : extractResponsesText(msg);
									const lineCount = text ? text.split("\n").length : 0;
									const approxTokens = text ? Math.max(1, Math.round(text.length / 4)) : 0;
									let meta: string | undefined;
									if (role === "reasoning" && reasoningParts) {
										const totalLen =
											reasoningParts.summaries.reduce((acc, s) => acc + s.length, 0) +
											(reasoningParts.contentText?.length ?? 0) +
											(reasoningParts.encrypted?.length ?? 0);
										const totalApprox = totalLen ? Math.max(1, Math.round(totalLen / 4)) : 0;
										const hasOpaqueOnly =
											(!!reasoningParts.encrypted || reasoningParts.signatures.length > 0) &&
											reasoningParts.summaries.length === 0 &&
											!reasoningParts.contentText;
										meta = totalApprox
											? `~${totalApprox} tokens${hasOpaqueOnly ? " · encrypted" : ""}`
											: hasOpaqueOnly
												? "encrypted"
												: undefined;
									} else {
										meta = text
											? role === "system" || role === "tool"
												? msg.name
													? `${msg.name} · ${lineCount} line${lineCount === 1 ? "" : "s"} · ~${approxTokens} tokens`
													: `${lineCount} line${lineCount === 1 ? "" : "s"} · ~${approxTokens} tokens`
												: `${lineCount} line${lineCount === 1 ? "" : "s"}`
											: msg.name
												? msg.name
												: msg.type === "function_call_output" && msg.call_id
													? msg.call_id
													: msg.type || undefined;
									}
									const usePlainText = role === "user" || role === "assistant";
									return (
										<MessageRow key={index} role={role} meta={meta} last={isLast}>
											{role === "reasoning" ? (
												reasoningHasAny && reasoningParts ? (
													<div className="space-y-3">
														{reasoningParts.contentText ? (
															<CollapsibleCode text={reasoningParts.contentText} preview={3} mono={false} />
														) : null}
														{reasoningParts.summaries.map((s, i) => (
															<div key={`s-${i}`} className="space-y-1">
																{reasoningParts.summaries.length > 1 ? (
																	<div className="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">
																		{t("logDetail.summaryN", { n: i + 1 })}
																	</div>
																) : null}
																<CollapsibleCode text={s} preview={3} mono={false} />
															</div>
														))}
														{reasoningParts.encrypted ? (
															<div className="space-y-1">
																<div className="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">{t("logDetail.encrypted")}</div>
																<CollapsibleCode text={reasoningParts.encrypted} preview={2} />
															</div>
														) : null}
														{reasoningParts.signatures.length > 0 ? (
															<EncryptedReveal
																text={reasoningParts.signatures.join("\n\n")}
																label={reasoningParts.signatures.length > 1 ? t("logDetail.encryptedSignatures") : t("logDetail.encryptedSignature")}
															/>
														) : null}
													</div>
												) : (
													<div className="text-muted-foreground text-[12px] italic">{t("logDetail.noReasoningContent")}</div>
												)
											) : text ? (
												usePlainText ? (
													<CollapsibleCode text={text} preview={3} mono={false} />
												) : (
													<CollapsibleCode text={text} preview={3} lang={role === "system" ? "xml" : undefined} />
												)
											) : msg.output !== undefined ? (
												<CollapsibleCode
													text={typeof msg.output === "string" ? msg.output : JSON.stringify(msg.output, null, 2)}
													preview={3}
												/>
											) : (
												<div className="text-muted-foreground text-[12px] italic">{t("logDetail.noContent")}</div>
											)}
											{Array.isArray(msg.content) &&
												msg.content
													.filter((b) => b?.type === "input_image" && b.image_url)
													.map((b, i) =>
														isLogBinaryPlaceholder(b.image_url!) ? (
															<div key={`${i}-${b.image_url}`} className="text-muted-foreground mt-2 font-mono text-xs">
																{b.image_url}
															</div>
														) : (
															<img
																key={`${i}-${b.image_url}`}
																src={b.image_url}
																alt={t("logDetail.attachedImage")}
																className="mt-2 max-w-full rounded border"
															/>
														),
													)}
										</MessageRow>
									);
								})}
							</div>
						);
					})()}

					{log.is_large_payload_request && !log.input_history?.length && !log.responses_input_history?.length && (
						<div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
							{t("logDetail.largePayloadRequestNotice")}
						</div>
					)}
					{log.is_large_payload_response && !log.output_message && !log.responses_output?.length && log.status !== "processing" && (
						<div className="rounded-sm border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300">
							{t("logDetail.largePayloadResponseNotice")}
						</div>
					)}

					{(log.error_details?.error.message || log.error_details?.error.error != null) && (
						<div className="rounded-sm border border-red-200 bg-red-50/70 p-5 dark:border-red-900 dark:bg-red-950/30">
							<div className="flex items-center gap-2 text-red-700 dark:text-red-400">
								<AlertCircle className="h-4 w-4 shrink-0" />
								<span className="text-[12.5px] font-semibold">{t("logDetail.error")}</span>
								{log.error_details?.error.message ? <CopyInlineButton text={log.error_details.error.message} /> : null}
							</div>
							{log.error_details?.error.message ? (
								<div className="mt-2 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-red-700 dark:text-red-400">
									{log.error_details.error.message}
								</div>
							) : null}
							{log.error_details?.error.error != null ? (
								<details className="group mt-3 rounded-sm border border-red-200/70 bg-white/40 dark:border-red-900/70 dark:bg-red-950/40">
									<summary className="flex cursor-pointer items-center justify-between px-3 py-2 text-[12px] text-red-700 hover:bg-red-50/80 dark:text-red-400 dark:hover:bg-red-950/60">
										<span className="font-medium">{t("logDetail.details")}</span>
										<ChevronDown className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
									</summary>
									<div className="custom-scrollbar max-h-[400px] overflow-y-auto border-t border-red-200/70 px-3 py-2 font-mono text-[11.5px] leading-[1.6] break-words whitespace-pre-wrap text-red-900 dark:border-red-900/70 dark:text-red-300">
										{typeof log.error_details.error.error === "string"
											? log.error_details.error.error
											: JSON.stringify(log.error_details.error.error, null, 2)}
									</div>
								</details>
							) : null}
						</div>
					)}
				</TabsContent>
			</Tabs>
		</>
	);
}

const copyRequestBody = async (log: LogEntry, copy: (text: string) => Promise<void>, t: TranslateFn) => {
	try {
		const isChat = log.object === "chat.completion" || log.object === "chat_completion" || log.object === "chat.completion.chunk";
		const isResponses = log.object === "response" || log.object === "response.completion.chunk";
		const isRealtimeTurn = log.object === "realtime.turn";
		const isSpeech = log.object === "audio.speech" || log.object === "audio.speech.chunk";
		const isTextCompletion = log.object === "text.completion" || log.object === "text.completion.chunk";
		const isEmbedding = log.object === "list";

		const extractTextFromMessage = (message: any): string => {
			if (!message || !message.content) {
				return "";
			}
			if (typeof message.content === "string") {
				return message.content;
			}
			if (Array.isArray(message.content)) {
				return message.content
					.filter((block: any) => block && block.type === "text" && block.text)
					.map((block: any) => block.text)
					.join("\n");
			}
			return "";
		};

		const extractTextsFromMessage = (message: any): string[] => {
			if (!message || !message.content) {
				return [];
			}
			if (typeof message.content === "string") {
				return message.content ? [message.content] : [];
			}
			if (Array.isArray(message.content)) {
				return message.content.filter((block: any) => block && block.type === "text" && block.text).map((block: any) => block.text);
			}
			return [];
		};

		const isSupportedType = isChat || isResponses || isRealtimeTurn || isSpeech || isTextCompletion || isEmbedding;
		if (!isSupportedType) {
			if (log.object === "audio.transcription" || log.object === "audio.transcription.chunk") {
				toast.error(t("logDetail.copyNotAvailableTranscription"));
			} else {
				toast.error(t("logDetail.copyNotAvailableType"));
			}
			return;
		}

		const requestBody: any = {
			model: log.provider && log.model ? `${log.provider}/${log.model}` : log.model || "",
		};

		if (isRealtimeTurn) {
			if (log.input_history && log.input_history.length > 0) {
				requestBody.messages = log.input_history;
			}
			if (log.output_message) {
				requestBody.output = log.output_message;
			}
		} else if (isChat && log.input_history && log.input_history.length > 0) {
			requestBody.messages = log.input_history;
		} else if (isResponses && log.responses_input_history && log.responses_input_history.length > 0) {
			requestBody.input = log.responses_input_history;
		} else if (isSpeech && log.speech_input) {
			requestBody.input = log.speech_input.input;
		} else if (isTextCompletion && log.input_history && log.input_history.length > 0) {
			const firstMessage = log.input_history[0];
			const prompt = extractTextFromMessage(firstMessage);
			if (prompt) {
				requestBody.prompt = prompt;
			}
		} else if (isEmbedding && log.input_history && log.input_history.length > 0) {
			const texts: string[] = [];
			for (const message of log.input_history) {
				const messageTexts = extractTextsFromMessage(message);
				texts.push(...messageTexts);
			}
			if (texts.length > 0) {
				requestBody.input = texts.length === 1 ? texts[0] : texts;
			}
		}

		if (log.params) {
			const paramsCopy = { ...log.params };
			delete paramsCopy.tools;
			delete paramsCopy.instructions;
			Object.assign(requestBody, paramsCopy);
		}

		if ((isChat || isResponses || isRealtimeTurn) && log.params?.tools && Array.isArray(log.params.tools) && log.params.tools.length > 0) {
			requestBody.tools = log.params.tools;
		}
		if ((isResponses || isRealtimeTurn) && log.params?.instructions) {
			requestBody.instructions = log.params.instructions;
		}

		const requestBodyJson = JSON.stringify(requestBody, null, 2);
		await copy(requestBodyJson);
	} catch {
		toast.error(t("logDetail.copyRequestBodyFailed"));
	}
};
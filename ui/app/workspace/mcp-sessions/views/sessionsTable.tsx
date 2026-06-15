// Base sessions table: renders token rows + pending flow rows + per-user
// header credential rows visible to the caller's identity. VK-keyed rows
// render directly with their VK ID; user-keyed rows show the preloaded
// user.name (falling back to email, then raw user_id). The `user` field
// is populated server-side by the enterprise configstore wrapper; OSS
// leaves it absent and the UI falls back to the raw ID.
//
// Status badges:
//   active:       token / header row, usable
//   orphaned:     credential row (token or header); caller lost their last
//                 granting VK. Credential still intact — auto-reactivates
//                 when access is restored. Re-auth / edit wouldn't help so
//                 the corresponding action is hidden.
//   needs_reauth: token row; upstream credential dead (refresh failed).
//                 Re-auth required.
//   needs_update: header row; admin changed the PerUserHeaderKeys schema.
//                 Caller must resubmit values.
//   pending:      flow row, user must complete OAuth authentication.

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { PIN_SHADOW_RIGHT } from "@/components/table/columnPinning";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getErrorMessage, useReauthMCPSessionMutation, useRevokeMCPSessionMutation } from "@/lib/store";
import { MCPSessionRow } from "@/lib/types/mcpSessions";
import { useT } from "@/lib/i18n";
import { useNavDescription } from "@/lib/i18n/useNavTitle";
import { ExternalLink, Fingerprint, KeyRound, Loader2, MoreHorizontal, Pencil, RefreshCcw, Trash2, UserRound } from "lucide-react";
import { useState } from "react";

interface SessionsTableProps {
	sessions: MCPSessionRow[];
}

export default function SessionsTable({ sessions }: SessionsTableProps) {
	const t = useT();
	const pageDescription = useNavDescription("authSessions");
	const { toast } = useToast();
	const [reauth, { isLoading: reauthing }] = useReauthMCPSessionMutation();
	const [revoke, { isLoading: revoking }] = useRevokeMCPSessionMutation();
	const [pendingDelete, setPendingDelete] = useState<MCPSessionRow | null>(null);
	const [pendingActionRowId, setPendingActionRowId] = useState<string | null>(null);

	const handleReauth = async (row: MCPSessionRow) => {
		setPendingActionRowId(row.id);
		try {
			const res = await reauth(row.id).unwrap();
			// Open the upstream authorize URL. User completes there, then
			// is redirected back to /api/oauth/callback by the provider.
			window.location.href = res.authorize_url;
		} catch (err) {
			setPendingActionRowId(null);
			toast({ title: t("mcp.sessions.reauthFailed"), description: getErrorMessage(err), variant: "destructive" });
		}
	};

	const confirmRevoke = async () => {
		if (!pendingDelete) return;
		const row = pendingDelete;
		setPendingDelete(null);
		setPendingActionRowId(row.id);
		try {
			await revoke(row.id).unwrap();
			toast({ title: row.kind === "header" ? t("mcp.sessions.headersRevoked") : t("mcp.sessions.sessionRevoked") });
		} catch (err) {
			toast({
				title: row.kind === "header" ? t("mcp.sessions.revokeHeaderFailed") : t("mcp.sessions.revokeSessionFailed"),
				description: getErrorMessage(err),
				variant: "destructive",
			});
		} finally {
			setPendingActionRowId(null);
		}
	};

	return (
		<div className="space-y-4">
			<AlertDialog open={pendingDelete !== null} onOpenChange={(open) => !open && setPendingDelete(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						{pendingDelete?.kind === "header" ? (
							<>
								<AlertDialogTitle>{t("mcp.sessions.revokeHeaderTitle")}</AlertDialogTitle>
								<AlertDialogDescription>{t("mcp.sessions.revokeHeaderDesc")}</AlertDialogDescription>
							</>
						) : (
							<>
								<AlertDialogTitle>{t("mcp.sessions.revokeOAuthTitle")}</AlertDialogTitle>
								<AlertDialogDescription>{t("mcp.sessions.revokeOAuthDesc")}</AlertDialogDescription>
							</>
						)}
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel data-testid="mcp-session-revoke-cancel">{t("common.actions.cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={confirmRevoke} data-testid="mcp-session-revoke-confirm">
							{t("mcp.sessions.revoke")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>

			<div className="flex items-center justify-between gap-4">
				<div>
					<h2 className="text-lg font-semibold tracking-tight">{t("mcp.authSessionsTitle")}</h2>
					<p className="text-muted-foreground text-sm">{pageDescription}</p>
				</div>
			</div>

			<div className="overflow-auto rounded-sm border">
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("mcp.sessions.client")}</TableHead>
							<TableHead>
								<HeaderWithTooltip label={t("mcp.sessions.type")} tooltip={t("mcp.sessions.typeTooltip")} />
							</TableHead>
							<TableHead>
								<HeaderWithTooltip label={t("mcp.sessions.boundTo")} tooltip={t("mcp.sessions.boundToTooltip")} />
							</TableHead>
							<TableHead>{t("tables.status")}</TableHead>
							<TableHead>
								<HeaderWithTooltip label={t("mcp.sessions.tokenExpiry")} tooltip={t("mcp.sessions.tokenExpiryTooltip")} />
							</TableHead>
							<TableHead>{t("mcp.sessions.created")}</TableHead>
							<TableHead className={`bg-muted sticky right-0 z-10 w-[56px] text-right ${PIN_SHADOW_RIGHT}`}></TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{sessions.length === 0 ? (
							<TableRow>
								<TableCell colSpan={7} className="h-24 text-center">
									<span className="text-muted-foreground text-sm">{t("mcp.sessions.emptyRow")}</span>
								</TableCell>
							</TableRow>
						) : (
							sessions.map((row) => (
								<TableRow key={`${row.kind}-${row.id}`} className="group">
									<TableCell className="font-medium">{row.mcp_client?.name || row.mcp_client?.client_id || "-"}</TableCell>
									<TableCell>
										<TypeBadge kind={row.kind} t={t} />
									</TableCell>
									<TableCell>
										<BindingCell row={row} t={t} />
									</TableCell>
									<TableCell>
										<StatusBadge status={row.status} kind={row.kind} t={t} />
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">
										<div className="flex flex-col">
											<span>{formatAccessExpiry(row, t)}</span>
											{row.last_refreshed_at && (
												<span className="text-xs">
													{t("mcp.sessions.refreshed", { time: formatRelativePast(row.last_refreshed_at, t) })}
												</span>
											)}
										</div>
									</TableCell>
									<TableCell className="text-muted-foreground text-sm">{formatRelativePast(row.created_at, t)}</TableCell>
									<TableCell
										className={`group-hover:bg-muted dark:bg-card dark:group-hover:bg-muted sticky right-0 z-10 bg-white text-right ${PIN_SHADOW_RIGHT}`}
									>
										<RowActions
											row={row}
											reauthing={reauthing}
											revoking={revoking}
											isPendingRow={pendingActionRowId === row.id}
											onReauth={() => handleReauth(row)}
											onRevoke={() => setPendingDelete(row)}
											t={t}
										/>
									</TableCell>
								</TableRow>
							))
						)}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}

function HeaderWithTooltip({ label, tooltip }: { label: string; tooltip: string }) {
	return (
		<TooltipProvider delayDuration={150}>
			<Tooltip>
				<TooltipTrigger asChild>
					<span className="inline-flex cursor-help items-center gap-2">
						{label}
						<Info className="text-muted-foreground size-3" />
					</span>
				</TooltipTrigger>
				<TooltipContent className="max-w-xs">{tooltip}</TooltipContent>
			</Tooltip>
		</TooltipProvider>
	);
}

function BindingCell({ row, t }: { row: MCPSessionRow; t: ReturnType<typeof useT> }) {
	if (row.auth_mode === "user" && row.user_id) {
		const displayName = row.user?.name || row.user?.email;
		return (
			<div className="flex items-center gap-1.5 text-sm">
				<UserRound className="text-muted-foreground size-3.5" />
				{displayName ? <span>{displayName}</span> : <span className="font-mono">{row.user_id}</span>}
			</div>
		);
	}
	if (row.auth_mode === "vk" && row.virtual_key) {
		return (
			<div className="flex items-center gap-1.5 text-sm">
				<KeyRound className="text-muted-foreground size-3.5" />
				<span>{row.virtual_key.name || row.virtual_key.id}</span>
			</div>
		);
	}
	if (row.auth_mode === "session" && row.session_id) {
		return (
			<div className="flex items-center gap-1.5 text-sm">
				<Fingerprint className="text-muted-foreground size-3.5" />
				<span className="font-mono">{row.session_id}</span>
			</div>
		);
	}
	return <span className="text-muted-foreground text-sm">{t("mcp.sessions.sessionBound")}</span>;
}

function TypeBadge({ kind, t }: { kind: string; t: ReturnType<typeof useT> }) {
	if (kind === "flow") {
		return <Badge variant="secondary">{t("mcp.sessions.pending")}</Badge>;
	}
	if (kind === "header") {
		return <Badge variant="outline">{t("mcp.sessions.typeHeaders")}</Badge>;
	}
	return <Badge variant="outline">{t("mcp.sessions.typeOAuth")}</Badge>;
}

function StatusBadge({ status, kind, t }: { status: string; kind: string; t: ReturnType<typeof useT> }) {
	if (kind === "flow") {
		return <Badge variant="secondary">{t("mcp.sessions.pending")}</Badge>;
	}
	if (status === "orphaned") {
		// Muted amber: distinct from destructive (red, action-required) and
		// secondary (gray, in-progress). Signals "informational, no action
		// needed from you" — the auto-restore cascade handles it.
		return (
			<Badge variant="outline" className="border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-900/30 dark:text-amber-200">
				{t("mcp.sessions.orphaned")}
			</Badge>
		);
	}
	if (status === "needs_reauth") {
		return <Badge variant="destructive">{t("mcp.sessions.needsReauth")}</Badge>;
	}
	if (status === "needs_update") {
		return <Badge variant="destructive">{t("mcp.sessions.needsUpdate")}</Badge>;
	}
	return <Badge>{t("mcp.sessions.active")}</Badge>;
}

interface RowActionsProps {
	row: MCPSessionRow;
	reauthing: boolean;
	revoking: boolean;
	isPendingRow: boolean;
	onReauth: () => void;
	onRevoke: () => void;
}

function RowActions({ row, reauthing, revoking, isPendingRow, onReauth, onRevoke, t }: RowActionsProps & { t: ReturnType<typeof useT> }) {
	const busy = reauthing || revoking;
	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="h-8 w-8"
					aria-label={t("mcp.sessions.sessionActionsAria")}
					data-testid={`mcp-session-row-actions-${row.id}`}
					disabled={busy}
				>
					{busy && isPendingRow ? <Loader2 className="h-4 w-4 animate-spin" /> : <MoreHorizontal className="h-4 w-4" />}
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{row.kind === "flow" ? (
					row.status === "needs_reauth" ? (
						// The PKCE state on this flow row is dead; a fresh request to the
						// MCP client will start a new flow. No action we can offer wires
						// up to the existing flow row, so surface guidance instead.
						<DropdownMenuItem disabled className="text-muted-foreground cursor-default text-xs">
							{t("mcp.sessions.triggerReauth")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							className="cursor-pointer"
							data-testid="mcp-session-complete-auth-menu-item"
							onSelect={(e) => {
								e.preventDefault();
								// Header flows need &kind=headers so the auth landing page
								// routes to the per-user-headers backend; OAuth flows use
								// the default branch.
								const url =
									row.auth_kind === "headers"
										? `/workspace/mcp-sessions/auth?flow=${row.id}&kind=headers`
										: `/workspace/mcp-sessions/auth?flow=${row.id}`;
								window.location.href = url;
							}}
						>
							<ExternalLink className="h-4 w-4" />
							{t("mcp.sessions.completeAuth")}
						</DropdownMenuItem>
					)
				) : row.kind === "header" ? (
					<>
						{row.status !== "orphaned" && (
							// "Edit values" hits reauth server-side: the handler mints a
							// fresh header submission flow + temp token and returns the
							// auth-landing URL. Same single-click → redirect dance as the
							// OAuth row's "Re-authenticate" action.
							<DropdownMenuItem
								className="cursor-pointer"
								disabled={busy}
								data-testid="mcp-session-edit-headers-menu-item"
								onSelect={(e) => {
									e.preventDefault();
									onReauth();
								}}
							>
								<Pencil className="h-4 w-4" />
								{row.status === "needs_update" ? t("mcp.sessions.updateValues") : t("mcp.sessions.editValues")}
							</DropdownMenuItem>
						)}
						<DropdownMenuItem
							variant="destructive"
							className="cursor-pointer"
							disabled={busy}
							data-testid="mcp-session-revoke-menu-item"
							onSelect={(e) => {
								e.preventDefault();
								onRevoke();
							}}
						>
							<Trash2 className="h-4 w-4" />
							{t("mcp.sessions.revoke")}
						</DropdownMenuItem>
					</>
				) : (
					<>
						{row.status !== "orphaned" && (
							// Re-auth on an orphaned row wouldn't help: the upstream
							// credential is intact, the user just no longer has any
							// granting VK. Surface guidance instead of an action.
							<DropdownMenuItem
								className="cursor-pointer"
								disabled={busy}
								data-testid="mcp-session-reauth-menu-item"
								onSelect={(e) => {
									e.preventDefault();
									onReauth();
								}}
							>
								<RefreshCcw className="h-4 w-4" />
								{t("mcp.sessions.reauthenticate")}
							</DropdownMenuItem>
						)}
						<DropdownMenuItem
							variant="destructive"
							className="cursor-pointer"
							disabled={busy}
							data-testid="mcp-session-revoke-menu-item"
							onSelect={(e) => {
								e.preventDefault();
								onRevoke();
							}}
						>
							<Trash2 className="h-4 w-4" />
							{t("mcp.sessions.revoke")}
						</DropdownMenuItem>
					</>
				)}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

function formatRelativePast(iso: string, t: ReturnType<typeof useT>): string {
	try {
		const timestamp = new Date(iso).getTime();
		if (Number.isNaN(timestamp)) return iso;
		const diffMs = Date.now() - timestamp;
		if (diffMs < 60_000) return t("mcp.sessions.justNow");
		const mins = Math.floor(diffMs / 60_000);
		if (mins < 60) return t("mcp.sessions.minAgo", { n: mins });
		const hours = Math.floor(diffMs / 3_600_000);
		if (hours < 48) return t("mcp.sessions.hAgo", { n: hours });
		const days = Math.floor(diffMs / 86_400_000);
		return t("mcp.sessions.dAgo", { n: days });
	} catch {
		return iso;
	}
}

function formatAccessExpiry(row: MCPSessionRow, t: ReturnType<typeof useT>): string {
	if (row.kind === "header") {
		return t("mcp.sessions.noExpiry");
	}
	if (!row.expires_at) return "-";
	try {
		const timestamp = new Date(row.expires_at).getTime();
		if (Number.isNaN(timestamp)) return row.expires_at;
		const diffMs = timestamp - Date.now();
		if (diffMs < 0) {
			switch (row.status) {
				case "active":
					return t("mcp.sessions.refreshesOnUse");
				case "orphaned":
					return t("mcp.sessions.refreshesOnRestore");
				default:
					return t("mcp.sessions.expired");
			}
		}
		const days = Math.floor(diffMs / 86_400_000);
		if (days > 1) return t("mcp.sessions.inDays", { n: days });
		const hours = Math.floor(diffMs / 3_600_000);
		if (hours > 1) return t("mcp.sessions.inHours", { n: hours });
		const mins = Math.floor(diffMs / 60_000);
		return t("mcp.sessions.inMinutes", { n: Math.max(mins, 1) });
	} catch {
		return row.expires_at;
	}
}
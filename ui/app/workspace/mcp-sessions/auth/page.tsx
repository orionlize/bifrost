// Auth landing route for inline-401 URLs returned by the inference path.
//
// Both per-user-OAuth and per-user-headers flows land here. The URL shape
// is identical except for the kind discriminator:
//   - OAuth:   {base}/workspace/mcp-sessions/auth?flow={flowId}#t={token}
//   - Headers: {base}/workspace/mcp-sessions/auth?flow={flowId}&kind=headers#t={token}
//
// The temp token in the URL fragment binds the page request to the flow ID,
// letting anonymous browser visitors complete the flow without a dashboard
// session. The page picks the right backend (oauth/per-user/flows vs
// mcp/per-user-headers/flows) based on the kind param.
//
// - OAuth flow:    fetches pending flow metadata, on "Authenticate" click
//                  requests the upstream authorize URL and redirects the
//                  browser. Upstream redirects back to /api/oauth/callback
//                  which completes the flow server-side.
// - Headers flow:  fetches the same flow row plus the schema and renders
//                  the values form, submitting back to the flow row's
//                  PUT endpoint. The backend verifies upstream, upserts
//                  the credential, and consumes the flow row + temp token.

import HeadersForm from "@/components/headersForm";
import FullPageLoader from "@/components/fullPageLoader";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useT, type TranslateFn } from "@/lib/i18n";
import { getActiveTempToken } from "@/lib/store/apis/tempToken";
import {
	getErrorMessage,
	useGetMCPFlowDetailQuery,
	useGetMCPPerUserHeadersFlowQuery,
	useIsAuthEnabledQuery,
	useStartMCPFlowMutation,
	useSubmitMCPPerUserHeadersFlowMutation,
} from "@/lib/store";
import { MCPFlowDetail } from "@/lib/types/mcpSessions";
import { MCPHeadersFlowDetail } from "@/lib/types/mcpPerUserHeaders";
import { Link } from "@tanstack/react-router";
import { CheckCircle2, ExternalLink, Fingerprint, KeyRound, Loader2, LogIn, ShieldCheck, TriangleAlert, UserRound } from "lucide-react";
import { useQueryState } from "nuqs";
import React from "react";
import { useMemo, useState } from "react";
export default function MCPSessionsAuthPage() {
	const [flowId] = useQueryState("flow");
	const [kind] = useQueryState("kind");

	// Both surfaces ride on ?flow={id}; `kind=headers` selects the headers
	// backend. Default (no kind / kind=oauth) is the OAuth branch — keeps the
	// OAuth URL shape unchanged.
	if (kind === "headers" && flowId) {
		return <HeadersAuthView flowId={flowId} />;
	}
	return <OAuthAuthView />;
}

function OAuthAuthView() {
	const t = useT();
	const { toast } = useToast();
	const [flowId] = useQueryState("flow");
	const skip = !flowId;
	const { data: flow, isLoading, isError, error } = useGetMCPFlowDetailQuery(flowId ?? "", { skip });
	const [startFlow, { isLoading: starting }] = useStartMCPFlowMutation();
	const { data: authState } = useIsAuthEnabledQuery();
	const [usingTempToken] = useState(() => getActiveTempToken() !== null);
	const loginRedirectUri = useMemo(() => {
		if (typeof window !== "undefined") {
			return `${window.location.pathname}${window.location.search}`;
		}
		if (flowId) {
			return `/workspace/mcp-sessions/auth?flow=${encodeURIComponent(flowId)}`;
		}
		return "/workspace/mcp-sessions/auth";
	}, [flowId]);
	const loginHref = useMemo(() => `/login?redirect_uri=${encodeURIComponent(loginRedirectUri)}`, [loginRedirectUri]);
	const showLoginOption = usingTempToken && authState?.is_auth_enabled === true && authState.has_valid_token === false;
	const showTempTokenSSOWarning = showLoginOption && authState.auth_type === "sso";

	if (!flowId) {
		return (
			<CenteredCard>
				<h1 className="text-xl font-semibold">{t("mcp.authFlow.missingFlow")}</h1>
				<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.missingFlowDesc")}</p>
				<div className="mt-6">
					<SessionsTabLink />
				</div>
			</CenteredCard>
		);
	}

	if (isLoading) {
		return <FullPageLoader />;
	}

	if (isError || !flow) {
		const status = (error as { status?: number } | undefined)?.status;
		if (status === 401) {
			return <InvalidLinkView />;
		}
		if (status === 403) {
			return (
				<CenteredCard>
					<h1 className="text-xl font-semibold">{t("mcp.authFlow.notYours")}</h1>
					<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.notYoursDesc")}</p>
					<div className="mt-6">
						<SessionsTabLink />
					</div>
				</CenteredCard>
			);
		}
		if (status === 404) {
			return (
				<CenteredCard>
					<h1 className="text-xl font-semibold">{t("mcp.authFlow.flowExpiredTitle")}</h1>
					<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.flowExpiredDesc")}</p>
					<div className="mt-6">
						<SessionsTabLink />
					</div>
				</CenteredCard>
			);
		}
		return (
			<CenteredCard>
				<h1 className="text-xl font-semibold">{t("mcp.authFlow.couldNotLoad")}</h1>
				<p className="text-muted-foreground mt-2 text-sm">{getErrorMessage(error)}</p>
			</CenteredCard>
		);
	}

	// Flow row exists but isn't pending: it's already been completed, failed,
	// or expired. Don't show the "Authenticate" button since startFlow would
	// reject (BuildUpstreamAuthorizeURL rejects non-pending flows).
	if (flow.status !== "pending") {
		return <CompletedFlowView flow={flow} />;
	}

	const handleAuthenticate = async () => {
		try {
			const res = await startFlow(flowId).unwrap();
			window.location.href = res.authorize_url;
		} catch (err) {
			toast({
				title: t("mcp.authFlow.startFailed"),
				description: getErrorMessage(err),
				variant: "destructive",
			});
		}
	};

	const mcpClientName = flow.mcp_client?.name || flow.mcp_client?.client_id || t("mcp.authFlow.defaultMcpServer");
	const isReauth = flow.has_active_token === true;

	return (
		<CenteredCard>
			<div className="bg-primary/10 mb-5 flex size-12 items-center justify-center rounded-full">
				<ShieldCheck className="text-primary size-6" />
			</div>
			<h1 className="text-xl font-semibold tracking-tight">
				{isReauth ? t("mcp.authFlow.reauthenticateWith") : t("mcp.authFlow.authenticateWith")} {mcpClientName}
			</h1>
			<p className="text-muted-foreground mt-2 text-sm">
				{isReauth ? t("mcp.authFlow.reauthenticateReplaceDesc") : t("mcp.authFlow.authenticateDesc")}
			</p>

			{showTempTokenSSOWarning ? (
				<Alert variant="warning" className="mt-6">
					<TriangleAlert />
					<AlertTitle>{t("mcp.authFlow.tempTokenAlert")}</AlertTitle>
					<AlertDescription>
						<p>{t("mcp.authFlow.tempTokenAlertDesc")}</p>
						<Button asChild variant="outline" size="sm" className="mt-2" data-testid="mcp-auth-login-instead-warning-button">
							<a href={loginHref}>
								<LogIn className="size-4" />
								{t("mcp.authFlow.logInInstead")}
							</a>
						</Button>
					</AlertDescription>
				</Alert>
			) : null}

			<dl className="bg-muted/40 mt-6 space-y-3 rounded-sm border p-4 text-sm">
				<DetailRow label={t("mcp.authFlow.mcpClient")} value={mcpClientName} mono={!flow.mcp_client?.name} />
				<DetailRow label={t("mcp.authFlow.boundTo")} value={<BindingValue flow={flow} />} />
				<DetailRow label={t("mcp.authFlow.flowExpires")} value={formatExpiry(flow.expires_at, t)} />
			</dl>

			<div className="mt-6 flex gap-3">
				<Button onClick={handleAuthenticate} disabled={starting} data-testid="mcp-auth-authenticate-button">
					{starting ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
					<span>{isReauth ? t("mcp.authFlow.reauthenticate") : t("mcp.authFlow.authenticate")}</span>
				</Button>
				{showLoginOption && !showTempTokenSSOWarning ? (
					<Button asChild variant="outline" data-testid="mcp-auth-login-instead-inline-button">
						<a href={loginHref}>
							<LogIn className="size-4" />
							{t("mcp.authFlow.logInInstead")}
						</a>
					</Button>
				) : null}
				<SessionsTabLink variant="ghost" />
			</div>
		</CenteredCard>
	);
}

// HeadersAuthView renders the per-user-headers submission form. Fetches the
// pending flow row + schema from /api/mcp/per-user-headers/flows/{id},
// renders one input per required key, PUTs the values back to the same flow
// endpoint. On success the backend verifies upstream, upserts the credential
// row, deletes the flow row + temp token, and we show a success card.
function HeadersAuthView({ flowId }: { flowId: string }) {
	const t = useT();
	const { toast } = useToast();
	const [submitted, setSubmitted] = useQueryState("submitted");
	// Skip the GET once the submit has completed — the backend deletes the
	// flow row on success, so any refetch returns 404 and we'd render the
	// "expired" view on top of a freshly successful submission.
	const { data: detail, isLoading, isError, error } = useGetMCPPerUserHeadersFlowQuery(flowId, { skip: submitted === "true" });
	const [submit, { isLoading: submitting }] = useSubmitMCPPerUserHeadersFlowMutation();

	if (submitted === "true") {
		return (
			<CenteredCard>
				<div className="mb-5 flex size-12 items-center justify-center rounded-full bg-emerald-500/10">
					<CheckCircle2 className="size-6 text-emerald-600" />
				</div>
				<h1 className="text-xl font-semibold tracking-tight">{t("mcp.authFlow.headersSaved")}</h1>
				<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.headersSavedDesc")}</p>
				<div className="mt-6 flex gap-3">
					<SessionsTabLink />
				</div>
			</CenteredCard>
		);
	}

	if (isLoading) {
		return <FullPageLoader />;
	}

	if (isError || !detail) {
		const status = (error as { status?: number } | undefined)?.status;
		if (status === 401) {
			return <InvalidLinkView />;
		}
		// Enterprise RBAC middleware short-circuits flow endpoints with 403
		// when the caller doesn't own the flow. Mirrors the OAuth branch above
		// so headers flows get the same dedicated card instead of falling
		// through to the generic load-failure state.
		if (status === 403) {
			return (
				<CenteredCard>
					<h1 className="text-xl font-semibold">{t("mcp.authFlow.headersNotYours")}</h1>
					<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.headersNotYoursDesc")}</p>
					<div className="mt-6">
						<SessionsTabLink />
					</div>
				</CenteredCard>
			);
		}
		if (status === 404 || status === 410) {
			return (
				<CenteredCard>
					<h1 className="text-xl font-semibold">{t("mcp.authFlow.submissionExpiredTitle")}</h1>
					<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.submissionExpiredDesc")}</p>
					<div className="mt-6">
						<SessionsTabLink />
					</div>
				</CenteredCard>
			);
		}
		return (
			<CenteredCard>
				<h1 className="text-xl font-semibold">{t("mcp.authFlow.couldNotLoadSubmission")}</h1>
				<p className="text-muted-foreground mt-2 text-sm">{getErrorMessage(error)}</p>
			</CenteredCard>
		);
	}

	const handleSubmit = async (values: Record<string, string>) => {
		try {
			await submit({ flowId, body: { headers: values } }).unwrap();
			void setSubmitted("true");
		} catch (err) {
			toast({
				title: t("mcp.authFlow.submissionFailed"),
				description: getErrorMessage(err),
				variant: "destructive",
			});
		}
	};

	const mcpClientName = detail.mcp_client?.name || detail.mcp_client?.client_id || t("mcp.authFlow.defaultMcpServer");
	const isEdit = detail.has_active_credential;
	const title = isEdit
		? t("mcp.authFlow.updateCredentials", { name: mcpClientName })
		: t("mcp.authFlow.submitCredentials", { name: mcpClientName });

	return (
		<CenteredCard>
			<div className="bg-primary/10 mb-5 flex size-12 items-center justify-center rounded-full">
				<ShieldCheck className="text-primary size-6" />
			</div>
			<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
			<p className="text-muted-foreground mt-2 text-sm">
				{isEdit ? t("mcp.authFlow.updateCredentialsDesc") : t("mcp.authFlow.submitCredentialsDesc")}
			</p>

			<dl className="bg-muted/40 mt-6 space-y-3 rounded-sm border p-4 text-sm">
				<DetailRow label={t("mcp.authFlow.mcpClient")} value={mcpClientName} mono={!detail.mcp_client?.name} />
				<DetailRow label={t("mcp.authFlow.boundTo")} value={<HeadersBindingValue flow={detail} />} />
				<DetailRow label={t("mcp.authFlow.flowExpires")} value={formatExpiry(detail.expires_at, t)} />
			</dl>

			<div className="mt-6">
				<HeadersForm
					requiredKeys={detail.required_header_keys}
					adminHeaderKeys={detail.admin_header_keys}
					previouslySubmittedKeys={detail.submitted_keys}
					onSubmit={handleSubmit}
					busy={submitting}
					submitLabel={isEdit ? t("common.actions.save") : t("mcp.authFlow.submit")}
					testIdPrefix="mcp-headers-submit"
				/>
			</div>
		</CenteredCard>
	);
}

function HeadersBindingValue({ flow }: { flow: MCPHeadersFlowDetail }) {
	const t = useT();

	if (flow.flow_mode === "user") {
		const userID = flow.user_id;
		if (!userID) {
			return (
				<span className="inline-flex items-center gap-2">
					<UserRound className="text-muted-foreground size-3.5" />
					<Badge variant="secondary">{t("mcp.authFlow.firstSignedIn")}</Badge>
				</span>
			);
		}
		const displayName = flow.user?.name || flow.user?.email;
		return (
			<span className="inline-flex items-center gap-2">
				<UserRound className="text-muted-foreground size-3.5" />
				{displayName ? <span>{displayName}</span> : <span className="font-mono">{userID}</span>}
			</span>
		);
	}
	if (flow.flow_mode === "vk" && flow.virtual_key) {
		return (
			<span className="inline-flex items-center gap-2">
				<KeyRound className="text-muted-foreground size-3.5" />
				<span>{flow.virtual_key.name || flow.virtual_key.id}</span>
			</span>
		);
	}
	if (flow.flow_mode === "session" && flow.session_id) {
		return (
			<span className="inline-flex items-center gap-2">
				<Fingerprint className="text-muted-foreground size-3.5" />
				<span className="font-mono">{flow.session_id}</span>
			</span>
		);
	}
	return <span className="text-muted-foreground italic">{t("mcp.authFlow.unknown")}</span>;
}

function CompletedFlowView({ flow }: { flow: MCPFlowDetail }) {
	const t = useT();
	const mcpClientName = flow.mcp_client?.name || flow.mcp_client?.client_id || t("mcp.authFlow.defaultThisServer");
	// has_active_token wins over the flow's row status: a pending flow with an
	// existing active token means OAuth was re-initiated unnecessarily.
	const effectivelyAuthorized = flow.status === "authorized" || flow.has_active_token;
	const title = effectivelyAuthorized
		? t("mcp.authFlow.alreadyAuthenticated")
		: flow.status === "expired"
			? t("mcp.authFlow.flowExpiredShort")
			: t("mcp.authFlow.flowCannotComplete");
	const body = effectivelyAuthorized
		? t("mcp.authFlow.alreadyAuthenticatedDesc", { name: mcpClientName })
		: t("mcp.authFlow.flowCannotCompleteDesc");
	return (
		<CenteredCard>
			<h1 className="text-xl font-semibold tracking-tight">{title}</h1>
			<p className="text-muted-foreground mt-2 text-sm">{body}</p>
			<dl className="bg-muted/40 mt-6 space-y-3 rounded-sm border p-4 text-sm">
				<DetailRow label={t("mcp.authFlow.mcpClient")} value={mcpClientName} mono={!flow.mcp_client?.name} />
				<DetailRow label={t("mcp.authFlow.boundTo")} value={<BindingValue flow={flow} />} />
			</dl>
			<div className="mt-6">
				<SessionsTabLink />
			</div>
		</CenteredCard>
	);
}

function DetailRow({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
	return (
		<div className="flex items-start justify-between gap-4">
			<dt className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{label}</dt>
			<dd className={`text-right text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
		</div>
	);
}

function BindingValue({ flow }: { flow: MCPFlowDetail }) {
	const t = useT();

	if (flow.flow_mode === "user") {
		const userID = flow.user_id;
		if (!userID) {
			return (
				<span className="inline-flex items-center gap-2">
					<UserRound className="text-muted-foreground size-3.5" />
					<Badge variant="secondary">{t("mcp.authFlow.firstSignedIn")}</Badge>
				</span>
			);
		}
		const displayName = flow.user?.name || flow.user?.email;
		return (
			<span className="inline-flex items-center gap-2">
				<UserRound className="text-muted-foreground size-3.5" />
				{displayName ? <span>{displayName}</span> : <span className="font-mono">{userID}</span>}
			</span>
		);
	}
	if (flow.flow_mode === "vk" && flow.virtual_key) {
		return (
			<span className="inline-flex items-center gap-2">
				<KeyRound className="text-muted-foreground size-3.5" />
				<span>{flow.virtual_key.name || flow.virtual_key.id}</span>
			</span>
		);
	}
	if (flow.flow_mode === "session" && flow.session_id) {
		return (
			<span className="inline-flex items-center gap-2">
				<Fingerprint className="text-muted-foreground size-3.5" />
				<span className="font-mono">{flow.session_id}</span>
			</span>
		);
	}
	return <span className="text-muted-foreground italic">{t("mcp.authFlow.unknown")}</span>;
}

function formatExpiry(iso: string, t: TranslateFn): string {
	try {
		const expiryTime = new Date(iso).getTime();
		if (Number.isNaN(expiryTime)) return iso;
		const diffMs = expiryTime - Date.now();
		if (diffMs < 0) return t("mcp.authFlow.expired");
		const mins = Math.floor(diffMs / 60_000);
		if (mins < 1) return t("mcp.authFlow.inLessThanMinute");
		if (mins === 1) return t("mcp.authFlow.inOneMinute");
		return t("mcp.authFlow.inMinutes", { n: mins });
	} catch {
		return iso;
	}
}

function CenteredCard({ children }: { children: React.ReactNode }) {
	return (
		<div className="mx-auto flex min-h-[calc(100dvh-6rem)] w-full max-w-xl items-center justify-center p-6">
			<div className="bg-card w-full rounded-sm border p-8 shadow-sm">{children}</div>
		</div>
	);
}

function SessionsTabLink({ variant = "outline" }: { variant?: "outline" | "ghost" }) {
	const t = useT();
	// Hide the link only when the visitor has no dashboard session — for them,
	// /workspace/mcp-sessions would 401 and bounce to /login. Admins (cookie
	// present) still see it. ClientLayout already cached this query for the
	// route, so this is a free hook call.
	const { data: authState } = useIsAuthEnabledQuery();
	if (authState?.is_auth_enabled && !authState.has_valid_token) {
		return null;
	}
	return (
		<Button asChild variant={variant} data-testid="mcp-auth-sessions-tab-link">
			<Link to="/workspace/mcp-sessions">{t("mcp.authFlow.openSessions")}</Link>
		</Button>
	);
}

// InvalidLinkView renders when the per-user-flow API returns 401, which now
// means the caller arrived without either a valid dashboard session or a
// valid mcp_auth temp token. Most often this is an expired or hand-edited
// link — the temp token embedded in the URL fragment has aged out or the
// fragment was dropped along the way. Trigger the original action again to
// get a fresh URL.
function InvalidLinkView() {
	const t = useT();
	return (
		<CenteredCard>
			<h1 className="text-xl font-semibold tracking-tight">{t("mcp.authFlow.linkInvalid")}</h1>
			<p className="text-muted-foreground mt-2 text-sm">{t("mcp.authFlow.invalidLinkDesc")}</p>
		</CenteredCard>
	);
}

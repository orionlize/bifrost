import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/lib/i18n";
import { getErrorMessage } from "@/lib/store/apis/baseApi";
import { useCompleteOAuthFlowMutation, useLazyGetOAuthConfigStatusQuery } from "@/lib/store/apis/mcpApi";
import { Loader2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

interface OAuth2AuthorizerProps {
	open: boolean;
	onClose: () => void;
	onSuccess: () => void;
	onError: (error: string) => void;
	authorizeUrl: string;
	oauthConfigId: string;
	mcpClientId: string;
	isPerUserOauth?: boolean;
}

export const OAuth2Authorizer: React.FC<OAuth2AuthorizerProps> = ({
	open,
	onClose,
	onSuccess,
	onError,
	authorizeUrl,
	oauthConfigId,
	isPerUserOauth,
}) => {
	const t = useT();
	const [status, setStatus] = useState<"confirm" | "pending" | "blocked" | "polling" | "success" | "failed">(
		isPerUserOauth ? "confirm" : "pending",
	);
	const [errorMessage, setErrorMessage] = useState<string | null>(null);
	const popupRef = useRef<Window | null>(null);
	const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
	const isCompletingRef = useRef(false);
	// Set to true when the user cancels so in-flight async callbacks do not
	// invoke onSuccess / onError / onClose after the dialog is dismissed.
	const cancelledRef = useRef(false);

	// RTK Query hooks
	const [getOAuthStatus] = useLazyGetOAuthConfigStatusQuery();
	const [completeOAuth] = useCompleteOAuthFlowMutation();

	// Stop polling
	const stopPolling = useCallback(() => {
		if (pollIntervalRef.current) {
			clearInterval(pollIntervalRef.current);
			pollIntervalRef.current = null;
		}
	}, []);

	// Handle successful OAuth completion
	const handleOAuthComplete = useCallback(async () => {
		if (cancelledRef.current) return;
		// Guard against concurrent calls (race between postMessage and polling)
		if (isCompletingRef.current) return;
		isCompletingRef.current = true;

		// Close popup if still open
		if (popupRef.current && !popupRef.current.closed) {
			popupRef.current.close();
		}

		// Call complete-oauth endpoint using RTK Query mutation
		// Use oauthConfigId instead of mcpClientId for multi-instance support
		try {
			await completeOAuth(oauthConfigId).unwrap();
			if (cancelledRef.current) return;
			setStatus("success");
			onSuccess();
		} catch (error) {
			if (cancelledRef.current) return;
			const errMsg = getErrorMessage(error);
			setStatus("failed");
			setErrorMessage(errMsg);
			onError(errMsg);
		}
	}, [oauthConfigId, completeOAuth, onSuccess, onError]);

	// Handle OAuth failure
	const handleOAuthFailed = useCallback(
		(reason: string) => {
			stopPolling();
			if (popupRef.current && !popupRef.current.closed) {
				popupRef.current.close();
			}
			if (cancelledRef.current) return;
			setStatus("failed");
			setErrorMessage(reason);
			onError(reason);
		},
		[stopPolling, onError],
	);

	// Check OAuth status (called by postMessage or polling)
	const checkOAuthStatus = useCallback(async () => {
		if (cancelledRef.current) return;
		try {
			const result = await getOAuthStatus(oauthConfigId).unwrap();
			if (cancelledRef.current) return;

			if (result.status === "authorized") {
				stopPolling();
				await handleOAuthComplete();
			} else if (result.status === "failed" || result.status === "expired") {
				handleOAuthFailed(t("mcp.oauthAuth.authorizationStatus", { status: result.status }));
			}
		} catch (error) {
			console.error("Error checking OAuth status:", error);
		}
	}, [oauthConfigId, getOAuthStatus, stopPolling, handleOAuthComplete, handleOAuthFailed, t]);

	// Poll OAuth status
	const startPolling = useCallback(() => {
		// Clear any existing interval
		if (pollIntervalRef.current) {
			clearInterval(pollIntervalRef.current);
		}

		pollIntervalRef.current = setInterval(async () => {
			// Check if popup is still open
			if (popupRef.current && popupRef.current.closed) {
				// Popup closed - check status before assuming cancellation
				// (OAuth callback page closes the popup after success)
				try {
					const result = await getOAuthStatus(oauthConfigId).unwrap();
					if (result.status === "authorized") {
						stopPolling();
						await handleOAuthComplete();
					} else if (result.status === "failed" || result.status === "expired") {
						stopPolling();
						handleOAuthFailed(t("mcp.oauthAuth.authFailed"));
					}
					// pending or other non-terminal: let polling continue
				} catch {
					// transient fetch error: let polling continue
				}
				return;
			}

			await checkOAuthStatus();
		}, 2000); // Poll every 2 seconds
	}, [checkOAuthStatus, getOAuthStatus, handleOAuthComplete, handleOAuthFailed, oauthConfigId, stopPolling, t]);

	// Open popup and start polling
	const openPopup = useCallback(() => {
		// Reset completion and cancelled guards for each fresh OAuth attempt
		isCompletingRef.current = false;
		cancelledRef.current = false;

		// Close any existing popup
		if (popupRef.current && !popupRef.current.closed) {
			popupRef.current.close();
		}

		// Open OAuth popup
		const width = 600;
		const height = 700;
		const left = window.screen.width / 2 - width / 2;
		const top = window.screen.height / 2 - height / 2;

		const popup = window.open(
			authorizeUrl,
			"oauth_popup",
			`width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
		);

		if (!popup || popup.closed) {
			popupRef.current = null;
			setStatus("blocked");
			return;
		}

		popupRef.current = popup;
		setStatus("polling");

		// Start polling OAuth status
		startPolling();
	}, [authorizeUrl, startPolling]);

	// Listen for postMessage from OAuth callback popup
	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			// Only accept messages from the popup we opened and our own callback origin.
			if (event.source !== popupRef.current || event.origin !== window.location.origin) {
				return;
			}

			if (event.data?.type === "oauth_success") {
				// Trigger immediate status check; stopPolling is called inside
				// checkOAuthStatus only after a confirmed terminal state, so
				// transient fetch errors still allow polling to continue.
				checkOAuthStatus();
			}
		};

		window.addEventListener("message", handleMessage);
		return () => {
			window.removeEventListener("message", handleMessage);
		};
	}, [checkOAuthStatus]);

	// Handle user confirming per-user OAuth test
	const handleConfirmPerUserOAuth = () => {
		openPopup();
	};

	// Cleanup on unmount
	useEffect(() => {
		return () => {
			stopPolling();
			if (popupRef.current && !popupRef.current.closed) {
				popupRef.current.close();
			}
		};
	}, [stopPolling]);

	const handleRetry = () => {
		setErrorMessage(null);
		isCompletingRef.current = false;
		if (isPerUserOauth) {
			setStatus("confirm");
		} else {
			openPopup();
		}
	};

	const handleCancel = () => {
		cancelledRef.current = true;
		stopPolling();
		isCompletingRef.current = false;
		if (popupRef.current && !popupRef.current.closed) {
			popupRef.current.close();
		}
		onClose();
	};

	return (
		<Dialog
			open={open}
			onOpenChange={(nextOpen) => {
				if (!nextOpen) {
					handleCancel();
				}
			}}
		>
			<DialogContent
				className="sm:max-w-md"
				onPointerDownOutside={(e) => {
					e.preventDefault();
					handleCancel();
				}}
				onEscapeKeyDown={(e) => {
					e.preventDefault();
					handleCancel();
				}}
			>
				<DialogHeader>
					<DialogTitle>{status === "confirm" ? t("mcp.oauthAuth.testTitle") : t("mcp.oauthAuth.authTitle")}</DialogTitle>
					<DialogDescription>
						{status === "confirm" && t("mcp.oauthAuth.confirmDescShort")}
						{status === "pending" && t("mcp.oauthAuth.pendingDesc")}
						{status === "blocked" && t("mcp.oauthAuth.blockedDesc")}
						{status === "polling" && t("mcp.oauthAuth.pollingDesc")}
						{status === "success" && t("mcp.oauthAuth.authSuccess")}
						{status === "failed" && t("mcp.oauthAuth.authFailed")}
					</DialogDescription>
				</DialogHeader>

				<div className="flex flex-col items-center justify-center space-y-4">
					{status === "confirm" && (
						<>
							<div className="text-muted-foreground space-y-3 text-sm">
								<p>{t("mcp.oauthAuth.verifyIntro")}</p>
								<p>{t("mcp.oauthAuth.verifyLogin")}</p>
								<p>{t("mcp.oauthAuth.verifyPerUser")}</p>
							</div>
							<div className="flex w-full justify-end space-x-2">
								<Button onClick={handleCancel} variant="outline" data-testid="per-user-oauth-cancel">
									{t("common.actions.cancel")}
								</Button>
								<Button onClick={handleConfirmPerUserOAuth} data-testid="per-user-oauth-confirm">
									{t("mcp.oauthAuth.continueTest")}
								</Button>
							</div>
						</>
					)}

					{(status === "pending" || status === "blocked") && (
						<>
							<p className="text-muted-foreground text-sm">
								{status === "blocked" ? t("mcp.oauthAuth.blockedOpenDesc") : t("mcp.oauthAuth.pendingOpenDesc")}
							</p>
							<div className="flex w-full justify-end space-x-2">
								<Button onClick={handleCancel} variant="outline" data-testid="oauth-pending-cancel-btn">
									{t("common.actions.cancel")}
								</Button>
								<Button onClick={openPopup} data-testid="oauth-open-window-btn">
									{t("mcp.oauthAuth.openWindow")}
								</Button>
							</div>
						</>
					)}

					{status === "polling" && (
						<>
							<Loader2 className="text-secondary-foreground h-4 w-4 animate-spin" />
							<p className="text-muted-foreground text-sm">{t("mcp.oauthAuth.completePopup")}</p>
						</>
					)}

					{status === "success" && (
						<>
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-green-100">
								<svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
								</svg>
							</div>
							<p className="text-sm text-green-600">{t("mcp.oauthAuth.connected")}</p>
						</>
					)}

					{status === "failed" && (
						<>
							<div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-100">
								<svg className="h-6 w-6 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
								</svg>
							</div>
							<p className="text-sm text-red-600">{errorMessage || t("mcp.oauthAuth.errorOccurred")}</p>
							<Button onClick={handleRetry} variant="outline">
								{t("common.actions.retry")}
							</Button>
						</>
					)}
				</div>

				{status === "polling" && (
					<div className="flex justify-end space-x-2">
						<Button onClick={handleCancel} variant="outline">
							{t("common.actions.cancel")}
						</Button>
					</div>
				)}
			</DialogContent>
		</Dialog>
	);
};

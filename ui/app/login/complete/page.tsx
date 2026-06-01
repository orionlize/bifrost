import { useLoginRedirectUri } from "@/lib/hooks/useLoginRedirectUri";
import { useT } from "@/lib/i18n";
import { useIsAuthEnabledQuery } from "@/lib/store/apis";
import { DEFAULT_POST_LOGIN_PATH } from "@/lib/utils/loginGoto";
import { executePostLoginRedirect } from "@/lib/utils/postLoginRedirect";
import { useEffect } from "react";

export default function LoginCompletePage() {
	const t = useT();
	const redirectUri = useLoginRedirectUri();
	const { data: authState, isLoading, isFetching } = useIsAuthEnabledQuery();

	useEffect(() => {
		if (!redirectUri) {
			window.location.replace(DEFAULT_POST_LOGIN_PATH);
			return;
		}
		if (isLoading || isFetching || authState === undefined) {
			return;
		}

		if (authState.is_auth_enabled && !authState.has_valid_token) {
			window.location.replace(`/login?redirect_uri=${encodeURIComponent(redirectUri)}`);
			return;
		}

		void executePostLoginRedirect(redirectUri);
	}, [authState, isFetching, isLoading, redirectUri]);

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<p className="text-muted-foreground text-sm">{t("auth.redirecting")}</p>
		</div>
	);
}

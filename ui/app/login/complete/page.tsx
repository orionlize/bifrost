import { useLoginRedirectUri } from "@/lib/hooks/useLoginRedirectUri";
import { useT } from "@/lib/i18n";
import { useIsAuthEnabledQuery } from "@/lib/store/apis";
import { probeAuthSessionAfterRedirect } from "@/lib/utils/authRedirect";
import { DEFAULT_POST_LOGIN_PATH } from "@/lib/utils/loginGoto";
import { getEndpointUrl } from "@/lib/utils/port";
import { executePostLoginRedirect } from "@/lib/utils/postLoginRedirect";
import { useEffect } from "react";

export default function LoginCompletePage() {
	const t = useT();
	const redirectUri = useLoginRedirectUri();
	const { data: authState, isLoading, isFetching } = useIsAuthEnabledQuery();

	useEffect(() => {
		if (isLoading || isFetching || authState === undefined) {
			return;
		}

		let cancelled = false;

		void (async () => {
			const auth = (await probeAuthSessionAfterRedirect()) ?? authState;
			if (cancelled) {
				return;
			}

			if (auth.is_auth_enabled && !auth.has_valid_token) {
				if (redirectUri) {
					window.location.replace(getEndpointUrl(`/login?redirect_uri=${encodeURIComponent(redirectUri)}`));
					return;
				}
				window.location.replace(getEndpointUrl("/login"));
				return;
			}

			if (redirectUri) {
				await executePostLoginRedirect(redirectUri);
				return;
			}

			window.location.replace(getEndpointUrl(DEFAULT_POST_LOGIN_PATH));
		})();

		return () => {
			cancelled = true;
		};
	}, [authState, isFetching, isLoading, redirectUri]);

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<p className="text-muted-foreground text-sm">{t("auth.redirecting")}</p>
		</div>
	);
}
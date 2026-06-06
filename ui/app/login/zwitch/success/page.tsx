import { Button } from "@/components/ui/button";
import { LoginBrandHeader } from "@/components/loginBrandHeader";
import { useT } from "@/lib/i18n";
import { LOGIN_SOURCE_ZWITCH, openZwitchDeeplink, resolveZwitchSuccessParams, stashZwitchAuth } from "@/lib/utils/zwitchLogin";
import { getEndpointUrl } from "@/lib/utils/port";
import { CheckCircle2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

export default function ZwitchSuccessPage() {
	const t = useT();
	const { accessToken, baseUrl } = useMemo(() => {
		if (typeof window === "undefined") {
			return { accessToken: "", baseUrl: null };
		}
		return resolveZwitchSuccessParams(window.location.search);
	}, []);
	const [deeplinkAttempted, setDeeplinkAttempted] = useState(false);

	useEffect(() => {
		if (!accessToken || !baseUrl) {
			return;
		}
		stashZwitchAuth(baseUrl, accessToken);
	}, [accessToken, baseUrl]);

	useEffect(() => {
		if (!accessToken || deeplinkAttempted) {
			return;
		}
		setDeeplinkAttempted(true);
		const timer = window.setTimeout(() => {
			openZwitchDeeplink(accessToken, baseUrl);
		}, 500);
		return () => window.clearTimeout(timer);
	}, [accessToken, baseUrl, deeplinkAttempted]);

	const handleOpenApp = () => {
		if (!accessToken) {
			return;
		}
		openZwitchDeeplink(accessToken, baseUrl);
	};

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-md">
				<div className="border-border bg-card w-full space-y-6 rounded-sm border p-8">
					<LoginBrandHeader />

					{accessToken ? (
						<div className="space-y-5 text-center">
							<div className="flex justify-center">
								<CheckCircle2 className="text-primary h-12 w-12" />
							</div>
							<div className="space-y-2">
								<h1 className="text-lg font-semibold">{t("auth.zdSwitch.loginSuccess")}</h1>
								<p className="text-muted-foreground text-sm">{t("auth.zdSwitch.openingApp")}</p>
								{baseUrl ? (
									<p className="text-muted-foreground text-xs break-all">{t("auth.zdSwitch.serviceUrl", { url: baseUrl })}</p>
								) : null}
							</div>
							<Button type="button" className="h-9 w-full text-sm" onClick={handleOpenApp} data-testid="zwitch-open-deeplink-button">
								{t("auth.zdSwitch.openApp")}
							</Button>
						</div>
					) : (
						<div className="space-y-2 text-center">
							<h1 className="text-lg font-semibold">{t("auth.zdSwitch.loginIncomplete")}</h1>
							<p className="text-muted-foreground text-sm">{t("auth.zdSwitch.missingToken")}</p>
							<Button
								type="button"
								variant="outline"
								className="h-9 w-full text-sm"
								onClick={() => {
									window.location.href = getEndpointUrl(`/login?source=${LOGIN_SOURCE_ZWITCH}`);
								}}
								data-testid="zwitch-retry-login-button"
							>
								{t("auth.zdSwitch.backToLogin")}
							</Button>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

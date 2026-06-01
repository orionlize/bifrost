import { ThemeProvider } from "@/components/themeProvider";
import { WebsiteDocumentHead } from "@/components/websiteDocumentHead";
import { I18nProvider } from "@/lib/i18n";
import { ReduxProvider } from "@/lib/store/provider";
import { defaultAuthenticatedPath, probeAuthSession, shouldEnterDashboard } from "@/lib/utils/authRedirect";
import { LOGIN_COMPLETE_PATH } from "@/lib/utils/loginGoto";
import { LOGIN_SOURCE_ZD_SWITCH, LOGIN_ZD_SWITCH_SUCCESS_PATH } from "@/lib/utils/zdSwitchLogin";
import { createFileRoute, redirect, useChildMatches, useLocation } from "@tanstack/react-router";
import LoginCompletePage from "./complete/page";
import LoginPage from "./page";
import ZdSwitchSuccessPage from "./zd-switch/success/page";

type LoginSearch = {
	redirect_uri?: string;
	source?: string;
	error?: string;
};

function RouteComponent() {
	const childMatches = useChildMatches();
	const pathname = useLocation({ select: (location) => location.pathname });
	const isCompleteRoute = childMatches.length > 0 || pathname === LOGIN_COMPLETE_PATH;
	const isZdSwitchSuccessRoute = pathname === LOGIN_ZD_SWITCH_SUCCESS_PATH || pathname.startsWith(`${LOGIN_ZD_SWITCH_SUCCESS_PATH}/`);

	return (
		<I18nProvider>
			<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
				<ReduxProvider>
					<WebsiteDocumentHead preferPublicApi />
					<div className="bg-background min-h-screen">
						{isZdSwitchSuccessRoute ? <ZdSwitchSuccessPage /> : isCompleteRoute ? <LoginCompletePage /> : <LoginPage />}
					</div>
				</ReduxProvider>
			</ThemeProvider>
		</I18nProvider>
	);
}

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): LoginSearch => ({
		redirect_uri: typeof search.redirect_uri === "string" ? search.redirect_uri : undefined,
		source: typeof search.source === "string" ? search.source : undefined,
		error: typeof search.error === "string" ? search.error : undefined,
	}),
	beforeLoad: async ({ location, search }) => {
		// Only the bare /login page — not /login/complete or /login/zd-switch/success.
		if (location.pathname !== "/login") {
			return;
		}
		if (search.source === LOGIN_SOURCE_ZD_SWITCH || search.redirect_uri) {
			return;
		}
		if (search.error) {
			return;
		}

		const auth = await probeAuthSession();
		if (shouldEnterDashboard(auth)) {
			throw redirect({ to: defaultAuthenticatedPath(), replace: true });
		}
	},
	component: RouteComponent,
});
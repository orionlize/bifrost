import { ThemeProvider } from "@/components/themeProvider";
import { WebsiteDocumentHead } from "@/components/websiteDocumentHead";
import { ReduxProvider } from "@/lib/store/provider";
import { defaultAuthenticatedPath, probeAuthSession, shouldEnterDashboard } from "@/lib/utils/authRedirect";
import { LOGIN_SOURCE_ZWITCH } from "@/lib/utils/zwitchLogin";
import { createFileRoute, redirect, Outlet, useChildMatches } from "@tanstack/react-router";
import LoginPage from "./page";

type LoginSearch = {
	redirect_uri?: string;
	source?: string;
	error?: string;
};

function RouteComponent() {
	const childMatches = useChildMatches();
	const hasChildRoute = childMatches.length > 0;

	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<ReduxProvider>
				<WebsiteDocumentHead preferPublicApi />
				<div className="bg-background min-h-screen">{hasChildRoute ? <Outlet /> : <LoginPage />}</div>
			</ReduxProvider>
		</ThemeProvider>
	);
}

export const Route = createFileRoute("/login")({
	validateSearch: (search: Record<string, unknown>): LoginSearch => ({
		redirect_uri: typeof search.redirect_uri === "string" ? search.redirect_uri : undefined,
		source: typeof search.source === "string" ? search.source : undefined,
		error: typeof search.error === "string" ? search.error : undefined,
	}),
	beforeLoad: async ({ location, search }) => {
		// Only the bare /login page — not /login/complete or /login/zwitch/success.
		if (location.pathname !== "/login") {
			return;
		}
		if (search.source === LOGIN_SOURCE_ZWITCH || search.redirect_uri) {
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
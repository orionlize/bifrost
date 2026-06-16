import { ThemeProvider } from "@/components/themeProvider";
import { WebsiteDocumentHead } from "@/components/websiteDocumentHead";
import AdminLoginView from "@enterprise/components/login/adminLoginView";
import { ReduxProvider } from "@/lib/store/provider";
import { defaultAuthenticatedPath, probeAuthSession, shouldRedirectFromAdminLogin } from "@/lib/utils/authRedirect";
import { createFileRoute, redirect } from "@tanstack/react-router";

function RouteComponent() {
	return (
		<ThemeProvider attribute="class" defaultTheme="system" enableSystem>
			<ReduxProvider>
				<WebsiteDocumentHead preferPublicApi />
				<div className="bg-background min-h-screen">
					<AdminLoginView />
				</div>
			</ReduxProvider>
		</ThemeProvider>
	);
}

export const Route = createFileRoute("/admin-login")({
	beforeLoad: async () => {
		const auth = await probeAuthSession();
		if (shouldRedirectFromAdminLogin(auth)) {
			throw redirect({ to: defaultAuthenticatedPath(), replace: true });
		}
	},
	component: RouteComponent,
});

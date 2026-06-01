import { AoneUserWorkspaceGuard } from "@/app/workspace/views/aoneUserWorkspaceGuard";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ClientLayout } from "../clientLayout";
import { getEndpointUrl } from "@/lib/utils/port";

function WorkspaceLayout({ children }: { children: React.ReactNode }) {
	return <ClientLayout>{children}</ClientLayout>;
}

function RouteComponent() {
	return (
		<WorkspaceLayout>
			<AoneUserWorkspaceGuard>
				<Outlet />
			</AoneUserWorkspaceGuard>
		</WorkspaceLayout>
	);
}

export const Route = createFileRoute("/workspace")({
	beforeLoad: async ({ location }) => {
		if (location.pathname !== "/workspace" && location.pathname !== "/workspace/") {
			return;
		}

		let isAoneUserSession = false;
		try {
			const response = await fetch(getEndpointUrl("/api/session/is-auth-enabled"), {
				credentials: "include",
			});
			if (response.ok) {
				const data = (await response.json()) as { is_aone_user_session?: boolean };
				isAoneUserSession = data.is_aone_user_session === true;
			}
		} catch {
			// Fall back to the admin default route below.
		}

		throw redirect({
			to: isAoneUserSession ? "/workspace/prompt-repo" : "/workspace/dashboard",
			replace: true,
		});
	},
	component: RouteComponent,
});
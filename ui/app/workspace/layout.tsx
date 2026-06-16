import { AoneUserWorkspaceGuard } from "@/app/workspace/views/aoneUserWorkspaceGuard";
import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { ClientLayout } from "../clientLayout";
import { getEndpointUrl } from "@/lib/utils/port";
import { AONE_USER_DEFAULT_WORKSPACE_PATH } from "@/lib/constants/aoneUserSession";

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

		let isAoneUserOnlySession = false;
		try {
			const response = await fetch(getEndpointUrl("/api/session/is-auth-enabled"), {
				credentials: "include",
			});
			if (response.ok) {
				const data = (await response.json()) as {
					is_aone_user_session?: boolean;
					is_local_admin_session?: boolean;
					has_valid_token?: boolean;
				};
				isAoneUserOnlySession =
					data.has_valid_token === true &&
					data.is_aone_user_session === true &&
					data.is_local_admin_session !== true;
			}
		} catch {
			// Fall back to the admin default route below.
		}

		throw redirect({
			to: isAoneUserOnlySession ? AONE_USER_DEFAULT_WORKSPACE_PATH : "/workspace/dashboard",
			replace: true,
		});
	},
	component: RouteComponent,
});
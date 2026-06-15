import { createFileRoute, Navigate, Outlet, useChildMatches } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useIsLocalAdminSession } from "@/hooks/useIsLocalAdminSession";
import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useIsAoneUserSession } from "@/hooks/useIsAoneUserSession";
import { useIsAuthEnabledQuery } from "@/lib/store/apis/sessionApi";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";

function RouteComponent() {
	const hasPluginsAccess = useRbac(RbacResource.Plugins, RbacOperation.View);
	const hasSettingsAccess = useRbac(RbacResource.Settings, RbacOperation.View);
	const isLocalAdmin = useIsLocalAdminSession();
	const isAoneUserSession = useIsAoneUserSession();
	const { data: authStatus } = useIsAuthEnabledQuery();
	const showAoneUsers = !IS_ENTERPRISE && (authStatus?.aone_oauth_enabled ?? false);
	const showMarketplace =
		isAoneUserSession || hasPluginsAccess || (showAoneUsers && isLocalAdmin) || hasSettingsAccess || !authStatus?.is_auth_enabled;

	const childMatches = useChildMatches();

	if (!showMarketplace) {
		return <NoPermissionView entity="marketplace" />;
	}

	if (childMatches.length === 0) {
		return <Navigate to="/workspace/marketplace/plugins" replace />;
	}

	return (
		<div className="mx-auto flex h-[calc(100dvh-50px)] min-h-0 w-full max-w-7xl flex-col">
			<Outlet />
		</div>
	);
}

export const Route = createFileRoute("/workspace/marketplace")({
	component: RouteComponent,
});
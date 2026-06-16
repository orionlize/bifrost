import { NoPermissionView } from "@/components/noPermissionView";
import { useIsAoneUserOnlySession } from "@/hooks/useIsAoneUserOnlySession";
import { useGetCoreConfigQuery } from "@/lib/store";
import { createFileRoute, Navigate } from "@tanstack/react-router";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import PromptsPage from "./page";

function RouteComponent() {
	const isAoneUserSession = useIsAoneUserOnlySession();
	const hasPromptRepositoryAccess = useRbac(RbacResource.PromptRepository, RbacOperation.View);
	const { data: coreConfig } = useGetCoreConfigQuery({});
	const isDbConnected = coreConfig?.is_db_connected ?? false;

	if (isAoneUserSession) {
		return <Navigate to="/workspace/marketplace/plugins" replace />;
	}
	if (!isDbConnected || !hasPromptRepositoryAccess) {
		return <NoPermissionView entity="configuration" />;
	}
	return <PromptsPage />;
}

export const Route = createFileRoute("/workspace/prompt-repo")({
	component: RouteComponent,
});
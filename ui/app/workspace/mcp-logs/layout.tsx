import { NoPermissionView } from "@/components/noPermissionView";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { createFileRoute } from "@tanstack/react-router";
import MCPLogsPage from "./page";

function RouteComponent() {
	const t = useT();
	const hasViewMCPLogsAccess = useRbac(RbacResource.MCPLogs, RbacOperation.View);
	if (!hasViewMCPLogsAccess) {
		return <NoPermissionView entity={t("mcp.permission.logs")} />;
	}
	return <MCPLogsPage />;
}

export const Route = createFileRoute("/workspace/mcp-logs")({
	component: RouteComponent,
});
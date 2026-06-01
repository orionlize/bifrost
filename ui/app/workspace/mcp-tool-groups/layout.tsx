import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import MCPToolGroupsPage from "./page";

function RouteComponent() {
	const t = useT();
	const hasMCPToolGroupsAccess = useRbac(RbacResource.MCPToolGroups, RbacOperation.View);
	if (!hasMCPToolGroupsAccess) {
		return <NoPermissionView entity={t("mcp.permission.toolGroups")} />;
	}
	return <MCPToolGroupsPage />;
}

export const Route = createFileRoute("/workspace/mcp-tool-groups")({
	component: RouteComponent,
});
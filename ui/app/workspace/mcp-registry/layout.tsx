import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import MCPServersPage from "./page";

function RouteComponent() {
	const t = useT();
	const hasMCPGatewayAccess = useRbac(RbacResource.MCPGateway, RbacOperation.View);
	if (!hasMCPGatewayAccess) {
		return <NoPermissionView entity={t("mcp.permission.gatewayConfig")} />;
	}
	return <MCPServersPage />;
}

export const Route = createFileRoute("/workspace/mcp-registry")({
	component: RouteComponent,
});
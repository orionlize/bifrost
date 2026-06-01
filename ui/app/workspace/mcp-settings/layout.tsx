import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import MCPSettingsPage from "./page";

function RouteComponent() {
	const t = useT();
	const hasMCPGatewayAccess = useRbac(RbacResource.MCPGateway, RbacOperation.Update);
	const hasSettingsAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	if (!hasMCPGatewayAccess || !hasSettingsAccess) {
		return <NoPermissionView entity={t("mcp.permission.gatewaySettings")} />;
	}
	return <MCPSettingsPage />;
}

export const Route = createFileRoute("/workspace/mcp-settings")({
	component: RouteComponent,
});
import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import AdaptiveRoutingPage from "./page";

function RouteComponent() {
	const t = useT();
	const hasAdaptiveRouterAccess = useRbac(RbacResource.AdaptiveRouter, RbacOperation.View);
	if (!hasAdaptiveRouterAccess) {
		return <NoPermissionView entity={t("features.permission.adaptiveRouting")} />;
	}
	return <AdaptiveRoutingPage />;
}

export const Route = createFileRoute("/workspace/adaptive-routing")({
	component: RouteComponent,
});
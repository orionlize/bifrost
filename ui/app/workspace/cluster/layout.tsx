import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import ClusterPage from "./page";

function RouteComponent() {
	const t = useT();
	const hasClusterAccess = useRbac(RbacResource.Cluster, RbacOperation.View);
	if (!hasClusterAccess) {
		return <NoPermissionView entity={t("features.permission.clusterConfig")} />;
	}
	return <ClusterPage />;
}

export const Route = createFileRoute("/workspace/cluster")({
	component: RouteComponent,
});
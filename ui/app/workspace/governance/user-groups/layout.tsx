import { createFileRoute } from "@tanstack/react-router";
import { NoPermissionView } from "@/components/noPermissionView";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import UserGroupsPage from "./page";

function RouteComponent() {
	const hasAccess = useRbac(RbacResource.VirtualKeys, RbacOperation.View);
	if (!hasAccess) {
		return <NoPermissionView entity="user groups" />;
	}
	return <UserGroupsPage />;
}

export const Route = createFileRoute("/workspace/governance/user-groups")({
	component: RouteComponent,
});
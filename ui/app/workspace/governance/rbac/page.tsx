import RBACView from "@enterprise/components/rbac/rbacView";

export default function GovernanceRbacPage() {
	return (
		<div className="mx-auto flex h-[calc(100vh_-_50px)] w-full max-w-7xl flex-col overflow-y-auto">
			<RBACView />
		</div>
	);
}
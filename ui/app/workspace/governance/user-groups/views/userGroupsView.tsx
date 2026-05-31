import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alertDialog";
import { Button } from "@/components/ui/button";
import { getErrorMessage } from "@/lib/store";
import { useDeleteUserGroupMutation, useGetUserGroupsQuery } from "@/lib/store/apis/userGroupsApi";
import { UserGroup } from "@/lib/types/userGroups";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { UserGroupSheet } from "./userGroupSheet";
import { UserGroupsTable } from "./userGroupsTable";
import { UserGroupUsageSheet } from "./userGroupUsageSheet";

export function UserGroupsView() {
	const [sheetOpen, setSheetOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<UserGroup | null>(null);
	const [usageOpen, setUsageOpen] = useState(false);
	const [usageGroup, setUsageGroup] = useState<UserGroup | null>(null);

	const canCreate = useRbac(RbacResource.VirtualKeys, RbacOperation.Create);
	const canUpdate = useRbac(RbacResource.VirtualKeys, RbacOperation.Update);
	const canDelete = useRbac(RbacResource.VirtualKeys, RbacOperation.Delete);

	const { data, isLoading } = useGetUserGroupsQuery();
	const [deleteGroup, { isLoading: isDeleting }] = useDeleteUserGroupMutation();

	const groups = data?.user_groups ?? [];

	const handleCreate = () => {
		setEditingGroup(null);
		setSheetOpen(true);
	};

	const handleEdit = (group: UserGroup) => {
		setEditingGroup(group);
		setSheetOpen(true);
	};

	const handleViewUsage = (group: UserGroup) => {
		setUsageGroup(group);
		setUsageOpen(true);
	};

	const handleConfirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteGroup(deleteTarget.id).unwrap();
			toast.success("User group deleted");
			setDeleteTarget(null);
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-foreground text-lg font-semibold">User Groups</h1>
					<p className="text-muted-foreground text-sm">
						Tag users into groups with tiered model degradation to cap high-cost AI consumption.
					</p>
				</div>
				{canCreate && (
					<Button onClick={handleCreate} className="gap-2" data-testid="create-user-group-btn">
						<Plus className="h-4 w-4" />
						<span className="hidden sm:inline">New Group</span>
					</Button>
				)}
			</div>

			<UserGroupsTable
				groups={groups}
				isLoading={isLoading}
				onEdit={handleEdit}
				onDelete={setDeleteTarget}
				onViewUsage={handleViewUsage}
				canUpdate={canUpdate}
				canDelete={canDelete}
			/>

			<UserGroupSheet open={sheetOpen} onOpenChange={setSheetOpen} editingGroup={editingGroup} />
			<UserGroupUsageSheet group={usageGroup} open={usageOpen} onOpenChange={setUsageOpen} />

			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>Delete user group?</AlertDialogTitle>
						<AlertDialogDescription>
							This will remove the group "{deleteTarget?.name}" and its degradation tiers. Members (users) are not deleted.
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting}>
							{isDeleting ? "Deleting..." : "Delete"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

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
import { useT } from "@/lib/i18n";
import { useNavDescription, useNavTitle } from "@/lib/i18n/useNavTitle";

export function UserGroupsView() {
	const t = useT();
	const pageTitle = useNavTitle("userGroups");
	const pageDescription = useNavDescription("userGroups");
	const [sheetOpen, setSheetOpen] = useState(false);
	const [editingGroup, setEditingGroup] = useState<UserGroup | null>(null);
	const [deleteTarget, setDeleteTarget] = useState<UserGroup | null>(null);

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

	const handleConfirmDelete = async () => {
		if (!deleteTarget) return;
		try {
			await deleteGroup(deleteTarget.id).unwrap();
			toast.success(t("governance.userGroups.deleted"));
			setDeleteTarget(null);
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	return (
		<div className="space-y-4">
			<div className="flex items-center justify-between">
				<div>
					<h1 className="text-foreground text-lg font-semibold">{pageTitle}</h1>
					<p className="text-muted-foreground text-sm">{pageDescription}</p>
				</div>
				{canCreate && (
					<Button onClick={handleCreate} className="gap-2" data-testid="create-user-group-btn">
						<Plus className="h-4 w-4" />
						<span className="hidden sm:inline">{t("governance.userGroups.newGroup")}</span>
					</Button>
				)}
			</div>

			<UserGroupsTable
				groups={groups}
				isLoading={isLoading}
				onEdit={handleEdit}
				onDelete={setDeleteTarget}
				canUpdate={canUpdate}
				canDelete={canDelete}
			/>

			<UserGroupSheet open={sheetOpen} onOpenChange={setSheetOpen} editingGroup={editingGroup} />

			<AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{t("governance.userGroups.deleteTitle")}</AlertDialogTitle>
						<AlertDialogDescription>
							{t("governance.userGroups.deleteDescription", { name: deleteTarget?.name ?? "" })}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("common.actions.cancel")}</AlertDialogCancel>
						<AlertDialogAction onClick={handleConfirmDelete} disabled={isDeleting}>
							{isDeleting ? t("common.actions.deleting") : t("common.actions.delete")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}

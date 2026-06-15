import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { UserGroup } from "@/lib/types/userGroups";
import { useT } from "@/lib/i18n";
import { formatTokenCount } from "@/lib/utils/numbers";
import { ChevronRight, Pencil, Trash2 } from "lucide-react";
import { Fragment, useState } from "react";
import { UserGroupUsagePanel } from "./userGroupUsagePanel";

interface UserGroupsTableProps {
	groups: UserGroup[];
	isLoading: boolean;
	onEdit: (group: UserGroup) => void;
	onDelete: (group: UserGroup) => void;
	canUpdate: boolean;
	canDelete: boolean;
}

function formatWindow(limit?: number): string {
	if (!limit) return "—";
	return `${formatTokenCount(limit)} tok`;
}

export function UserGroupsTable({ groups, isLoading, onEdit, onDelete, canUpdate, canDelete }: UserGroupsTableProps) {
	const t = useT();
	const [expandedId, setExpandedId] = useState<string | null>(null);

	const toggleExpanded = (groupId: string) => {
		setExpandedId((prev) => (prev === groupId ? null : groupId));
	};

	return (
		<div className="rounded-md border" data-testid="user-groups-table">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead className="w-10" />
						<TableHead>{t("governance.userGroups.tableName")}</TableHead>
						<TableHead>{t("governance.userGroups.tableShortWindow")}</TableHead>
						<TableHead>{t("governance.userGroups.tableWeeklyWindow")}</TableHead>
						<TableHead>{t("governance.userGroups.tableTiers")}</TableHead>
						<TableHead>{t("governance.userGroups.tableMembers")}</TableHead>
						<TableHead className="text-right">{t("governance.userGroups.tableActions")}</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading && groups.length === 0 ? (
						<TableRow>
							<TableCell colSpan={7} className="text-muted-foreground py-8 text-center text-sm">
								{t("governance.userGroups.tableLoading")}
							</TableCell>
						</TableRow>
					) : groups.length === 0 ? (
						<TableRow>
							<TableCell colSpan={7} className="text-muted-foreground py-8 text-center text-sm">
								{t("governance.userGroups.tableEmpty")}
							</TableCell>
						</TableRow>
					) : (
						groups.map((group) => {
							const isExpanded = expandedId === group.id;
							return (
								<Fragment key={group.id}>
									<TableRow
										className="cursor-pointer"
										data-testid={`user-group-row-${group.id}`}
										data-expanded={isExpanded}
										aria-expanded={isExpanded}
										onClick={() => toggleExpanded(group.id)}
									>
										<TableCell className="w-10 py-3">
											<ChevronRight
												className={cn("text-muted-foreground h-4 w-4 shrink-0 transition-transform", isExpanded && "rotate-90")}
											/>
										</TableCell>
										<TableCell>
											<div className="flex items-center gap-2">
												{group.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} /> : null}
												<span className="font-medium">{group.name}</span>
												{group.enabled === false && (
													<Badge variant="secondary" className="text-xs">
														{t("governance.userGroups.disabled")}
													</Badge>
												)}
											</div>
											{group.description ? <p className="text-muted-foreground mt-0.5 text-xs">{group.description}</p> : null}
										</TableCell>
										<TableCell className="text-sm">{formatWindow(group.short_window_token_limit)}</TableCell>
										<TableCell className="text-sm">{formatWindow(group.weekly_window_token_limit)}</TableCell>
										<TableCell>
											<Badge variant="outline">{group.tiers?.length ?? 0}</Badge>
										</TableCell>
										<TableCell>
											<Badge variant="outline">{group.member_count ?? group.members?.length ?? 0}</Badge>
										</TableCell>
										<TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
											<div className="flex items-center justify-end gap-1">
												{canUpdate && (
													<Button variant="ghost" size="icon" data-testid={`user-group-edit-${group.id}`} onClick={() => onEdit(group)}>
														<Pencil className="h-4 w-4" />
													</Button>
												)}
												{canDelete && (
													<Button variant="ghost" size="icon" data-testid={`user-group-delete-${group.id}`} onClick={() => onDelete(group)}>
														<Trash2 className="text-destructive h-4 w-4" />
													</Button>
												)}
											</div>
										</TableCell>
									</TableRow>
									{isExpanded ? (
										<TableRow data-testid={`user-group-expanded-${group.id}`}>
											<TableCell colSpan={7} className="p-0">
												<UserGroupUsagePanel group={group} active canUpdate={canUpdate} />
											</TableCell>
										</TableRow>
									) : null}
								</Fragment>
							);
						})
					)}
				</TableBody>
			</Table>
		</div>
	);
}
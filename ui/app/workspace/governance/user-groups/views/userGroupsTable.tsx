import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { UserGroup } from "@/lib/types/userGroups";
import { Activity, Pencil, Trash2 } from "lucide-react";

interface UserGroupsTableProps {
	groups: UserGroup[];
	isLoading: boolean;
	onEdit: (group: UserGroup) => void;
	onDelete: (group: UserGroup) => void;
	onViewUsage: (group: UserGroup) => void;
	canUpdate: boolean;
	canDelete: boolean;
}

function formatTokensM(tokens: number): string {
	const millions = tokens / 1_000_000;
	const s = Number.isInteger(millions) ? String(millions) : millions.toFixed(2).replace(/\.?0+$/, "");
	return `${s}M`;
}

function formatWindow(limit?: number, duration?: string): string {
	if (!limit || !duration) return "—";
	return `${formatTokensM(limit)} tok / ${duration}`;
}

export function UserGroupsTable({ groups, isLoading, onEdit, onDelete, onViewUsage, canUpdate, canDelete }: UserGroupsTableProps) {
	return (
		<div className="rounded-md border" data-testid="user-groups-table">
			<Table>
				<TableHeader>
					<TableRow>
						<TableHead>Name</TableHead>
						<TableHead>Short window (5h)</TableHead>
						<TableHead>Weekly window</TableHead>
						<TableHead>Tiers</TableHead>
						<TableHead>Members</TableHead>
						<TableHead className="text-right">Actions</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{isLoading && groups.length === 0 ? (
						<TableRow>
							<TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
								Loading user groups...
							</TableCell>
						</TableRow>
					) : groups.length === 0 ? (
						<TableRow>
							<TableCell colSpan={6} className="text-muted-foreground py-8 text-center text-sm">
								No user groups found.
							</TableCell>
						</TableRow>
					) : (
						groups.map((group) => (
							<TableRow key={group.id} data-testid={`user-group-row-${group.id}`}>
								<TableCell>
									<div className="flex items-center gap-2">
										{group.color ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: group.color }} /> : null}
										<span className="font-medium">{group.name}</span>
										{group.enabled === false && (
											<Badge variant="secondary" className="text-xs">
												Disabled
											</Badge>
										)}
									</div>
									{group.description ? <p className="text-muted-foreground mt-0.5 text-xs">{group.description}</p> : null}
								</TableCell>
								<TableCell className="text-sm">{formatWindow(group.short_window_token_limit, group.short_window_reset_duration)}</TableCell>
								<TableCell className="text-sm">
									{formatWindow(group.weekly_window_token_limit, group.weekly_window_reset_duration)}
								</TableCell>
								<TableCell>
									<Badge variant="outline">{group.tiers?.length ?? 0}</Badge>
								</TableCell>
								<TableCell>
									<Badge variant="outline">{group.member_count ?? group.members?.length ?? 0}</Badge>
								</TableCell>
								<TableCell className="text-right">
									<div className="flex items-center justify-end gap-1">
										<Button
											variant="ghost"
											size="icon"
											data-testid={`user-group-usage-${group.id}`}
											onClick={() => onViewUsage(group)}
											title="View usage & degradation"
										>
											<Activity className="h-4 w-4" />
										</Button>
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
						))
					)}
				</TableBody>
			</Table>
		</div>
	);
}

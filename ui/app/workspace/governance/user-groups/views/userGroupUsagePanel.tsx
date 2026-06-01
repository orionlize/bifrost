import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useT } from "@/lib/i18n";
import { getErrorMessage } from "@/lib/store";
import { useGetUserGroupUsageQuery, useResetUserGroupMemberUsageMutation } from "@/lib/store/apis/userGroupsApi";
import { UserGroup, UserGroupMemberUsage, UserGroupWindowStatus } from "@/lib/types/userGroups";
import { formatTokenCount } from "@/lib/utils/numbers";
import { cn } from "@/lib/utils";
import { RotateCcw } from "lucide-react";
import { useCallback, useState } from "react";
import { toast } from "sonner";

const POLLING_INTERVAL = 5000;

interface UserGroupUsagePanelProps {
	group: UserGroup;
	active: boolean;
	canUpdate: boolean;
}

function findWindow(member: UserGroupMemberUsage, window: string): UserGroupWindowStatus | undefined {
	return member.windows?.find((w) => w.window === window);
}

function WindowCell({ status }: { status?: UserGroupWindowStatus }) {
	if (!status) return <span className="text-muted-foreground text-xs">—</span>;
	const barValue = Math.min(100, Math.round(status.percent_used));
	const isOverLimit =
		status.token_limit != null && status.token_limit > 0 && status.token_used >= status.token_limit;
	return (
		<div className="space-y-1">
			<div className="text-xs">
				{formatTokenCount(status.token_used)} / {status.token_limit != null ? formatTokenCount(status.token_limit) : "∞"} (
				{Math.round(status.percent_used)}%)
			</div>
			<Progress value={barValue} className={cn("h-1.5", isOverLimit && "[&>div]:bg-red-500/70")} />
		</div>
	);
}

export function UserGroupUsagePanel({ group, active, canUpdate }: UserGroupUsagePanelProps) {
	const t = useT();
	const [resettingId, setResettingId] = useState<string | null>(null);
	const { data, isLoading, isFetching } = useGetUserGroupUsageQuery(group.id, {
		skip: !active,
		pollingInterval: active ? POLLING_INTERVAL : 0,
	});
	const [resetUsage] = useResetUserGroupMemberUsageMutation();

	const usage = data?.usage ?? [];

	const handleResetUsage = useCallback(
		async (member: UserGroupMemberUsage) => {
			const displayName = member.virtual_key_name || member.identity;
			setResettingId(member.identity);
			try {
				await resetUsage({ groupId: group.id, data: { identity: member.identity } }).unwrap();
				toast.success(t("governance.usage.resetUsageSuccess", { name: displayName }));
			} catch (error) {
				toast.error(getErrorMessage(error) || t("governance.usage.resetUsageFailed"));
			} finally {
				setResettingId(null);
			}
		},
		[group.id, resetUsage, t],
	);

	return (
		<div className="border-t bg-muted/20" data-testid="user-group-usage-content">
			<div className="px-4 py-3">
				<p className="text-muted-foreground mb-3 text-xs">{t("governance.usage.description")}</p>
				<Table>
					<TableHeader>
						<TableRow>
							<TableHead>{t("governance.usage.tableUser")}</TableHead>
							<TableHead>{t("governance.usage.tableShort")}</TableHead>
							<TableHead>{t("governance.usage.tableWeekly")}</TableHead>
							<TableHead>{t("governance.usage.tableActiveTier")}</TableHead>
							{canUpdate ? <TableHead className="text-right">{t("governance.usage.tableActions")}</TableHead> : null}
						</TableRow>
					</TableHeader>
					<TableBody>
						{isLoading && usage.length === 0 ? (
							<TableRow>
								<TableCell colSpan={canUpdate ? 5 : 4} className="text-muted-foreground py-8 text-center text-sm">
									{t("governance.usage.loading")}
								</TableCell>
							</TableRow>
						) : usage.length === 0 ? (
							<TableRow>
								<TableCell colSpan={canUpdate ? 5 : 4} className="text-muted-foreground py-8 text-center text-sm">
									{t("governance.usage.noMembers")}
								</TableCell>
							</TableRow>
						) : (
							usage.map((member) => {
								const displayName = member.virtual_key_name || member.identity;
								const isResetting = resettingId === member.identity;
								return (
									<TableRow key={member.identity} data-testid={`user-group-usage-row-${member.identity}`}>
										<TableCell>
											<div className="font-medium">{displayName}</div>
											<div className="text-muted-foreground text-xs">
												{t("governance.usage.percentUsed", { percent: Math.round(member.usage_percent) })}
											</div>
										</TableCell>
										<TableCell className="min-w-[140px]">
											<WindowCell status={findWindow(member, "short")} />
										</TableCell>
										<TableCell className="min-w-[140px]">
											<WindowCell status={findWindow(member, "weekly")} />
										</TableCell>
										<TableCell>
											{member.active_tier_order != null ? (
												<div className="space-y-1">
													<Badge variant={member.active_tier_is_terminal ? "destructive" : "secondary"}>
														{t("governance.usage.tier", { order: member.active_tier_order })}
														{member.active_tier_is_terminal ? t("governance.usage.terminal") : ""}
													</Badge>
													{member.active_tier_threshold_pct != null ? (
														<p className="text-muted-foreground text-xs">
															{t("governance.userGroups.thresholdPct")}: {member.active_tier_threshold_pct}%
														</p>
													) : null}
												</div>
											) : (
												<Badge variant="outline">{t("governance.usage.normal")}</Badge>
											)}
										</TableCell>
										{canUpdate ? (
											<TableCell className="text-right">
												<Button
													type="button"
													variant="ghost"
													size="sm"
													disabled={isResetting}
													isLoading={isResetting}
													aria-label={t("governance.usage.resetUsageAria", { name: displayName })}
													data-testid={`user-group-usage-reset-${member.identity}`}
													onClick={() => handleResetUsage(member)}
												>
													<RotateCcw className="h-3.5 w-3.5" />
													{t("governance.usage.resetUsage")}
												</Button>
											</TableCell>
										) : null}
									</TableRow>
								);
							})
						)}
					</TableBody>
				</Table>
				{isFetching && usage.length > 0 ? (
					<p className="text-muted-foreground mt-2 text-right text-xs">{t("governance.usage.refreshing")}</p>
				) : null}
			</div>
		</div>
	);
}

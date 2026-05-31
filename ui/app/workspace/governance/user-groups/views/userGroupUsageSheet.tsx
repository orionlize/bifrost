import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useGetUserGroupUsageQuery } from "@/lib/store/apis/userGroupsApi";
import { UserGroup, UserGroupMemberUsage, UserGroupWindowStatus } from "@/lib/types/userGroups";

const POLLING_INTERVAL = 5000;

interface UserGroupUsageSheetProps {
	group: UserGroup | null;
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

function windowLabel(window: string): string {
	if (window === "short") return "Short (5h)";
	if (window === "weekly") return "Weekly";
	return window;
}

function findWindow(member: UserGroupMemberUsage, window: string): UserGroupWindowStatus | undefined {
	return member.windows?.find((w) => w.window === window);
}

function formatTokensM(tokens: number): string {
	const millions = tokens / 1_000_000;
	const s = Number.isInteger(millions) ? String(millions) : millions.toFixed(2).replace(/\.?0+$/, "");
	return `${s}M`;
}

function WindowCell({ status }: { status?: UserGroupWindowStatus }) {
	if (!status) return <span className="text-muted-foreground text-xs">—</span>;
	const pct = Math.min(100, Math.round(status.percent_used));
	return (
		<div className="space-y-1">
			<div className="text-xs">
				{formatTokensM(status.token_used)} / {status.token_limit != null ? formatTokensM(status.token_limit) : "∞"} (
				{Math.round(status.percent_used)}%)
			</div>
			<Progress value={pct} className="h-1.5" />
		</div>
	);
}

export function UserGroupUsageSheet({ group, open, onOpenChange }: UserGroupUsageSheetProps) {
	const { data, isLoading, isFetching } = useGetUserGroupUsageQuery(group?.id ?? "", {
		skip: !group?.id || !open,
		pollingInterval: POLLING_INTERVAL,
	});

	const usage = data?.usage ?? [];

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-2xl">
				<SheetHeader>
					<SheetTitle>Usage & degradation — {group?.name}</SheetTitle>
					<SheetDescription>
						Live per-user window consumption and the currently active degradation tier. Refreshes automatically.
					</SheetDescription>
				</SheetHeader>

				<div className="px-4 pb-8" data-testid="user-group-usage-content">
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>User (virtual key)</TableHead>
								<TableHead>Short (5h)</TableHead>
								<TableHead>Weekly</TableHead>
								<TableHead>Active tier</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{isLoading && usage.length === 0 ? (
								<TableRow>
									<TableCell colSpan={4} className="text-muted-foreground py-8 text-center text-sm">
										Loading usage...
									</TableCell>
								</TableRow>
							) : usage.length === 0 ? (
								<TableRow>
									<TableCell colSpan={4} className="text-muted-foreground py-8 text-center text-sm">
										No member usage recorded yet.
									</TableCell>
								</TableRow>
							) : (
								usage.map((member) => (
									<TableRow key={member.identity} data-testid={`user-group-usage-row-${member.identity}`}>
										<TableCell>
											<div className="font-medium">{member.virtual_key_name || member.identity}</div>
											<div className="text-muted-foreground text-xs">{Math.round(member.usage_percent)}% used</div>
										</TableCell>
										<TableCell className="min-w-[140px]">
											<WindowCell status={findWindow(member, "short")} />
										</TableCell>
										<TableCell className="min-w-[140px]">
											<WindowCell status={findWindow(member, "weekly")} />
										</TableCell>
										<TableCell>
											{member.active_tier_order != null ? (
												<Badge variant={member.active_tier_is_terminal ? "destructive" : "secondary"}>
													Tier {member.active_tier_order}
													{member.active_tier_is_terminal ? " (terminal)" : ""}
												</Badge>
											) : (
												<Badge variant="outline">Normal</Badge>
											)}
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
					{isFetching && usage.length > 0 ? <p className="text-muted-foreground mt-2 text-right text-xs">Refreshing…</p> : null}
				</div>
			</SheetContent>
		</Sheet>
	);
}

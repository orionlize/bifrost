import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { formatDateShanghai, formatDateTimeShanghai, formatRelativeTimeLocalized } from "@/lib/i18n/dateTime";
import { aoneUserStatusLabel } from "@/lib/i18n/filterLabels";
import { useI18n, useT } from "@/lib/i18n";
import { getErrorMessage } from "@/lib/store";
import MarketplaceUserAssignments from "@/app/workspace/marketplace/views/marketplaceUserAssignments";
import { useGetAoneUserQuery, useListAoneUsersQuery, useUpdateAoneUserMutation } from "@/lib/store/apis/aoneUsersApi";
import type { AoneUserDetailResponse, AoneUserListItem } from "@/lib/types/aoneUser";
import {
	Briefcase,
	Building2,
	ChevronLeft,
	ChevronRight,
	Search,
	ShieldCheck,
	UserRound,
	Users,
} from "lucide-react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

const PAGE_SIZE = 25;

function userInitials(name: string) {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) {
		return "?";
	}
	if (parts.length === 1) {
		return parts[0].slice(0, 2).toUpperCase();
	}
	return `${parts[0][0] ?? ""}${parts[1][0] ?? ""}`.toUpperCase();
}

function resolveDisplayName(user?: Pick<AoneUserListItem, "display_name" | "name" | "id">) {
	if (!user) {
		return "";
	}
	return user.display_name || user.name || user.id;
}

function resolveAvatar(user?: Pick<AoneUserListItem, "display_avatar" | "avatar">) {
	if (!user) {
		return "";
	}
	return user.display_avatar || user.avatar;
}

export default function AoneUsersView() {
	const t = useT();
	const [urlState, setUrlState] = useQueryStates(
		{
			search: parseAsString.withDefault(""),
			offset: parseAsInteger.withDefault(0),
			selected_user: parseAsString.withDefault(""),
		},
		{ history: "push" },
	);

	const debouncedSearch = useDebouncedValue(urlState.search, 300);

	const { data, isLoading, isError, error, isFetching } = useListAoneUsersQuery({
		limit: PAGE_SIZE,
		offset: urlState.offset,
		search: debouncedSearch || undefined,
	});

	const users = data?.users ?? [];
	const totalCount = data?.total_count ?? 0;
	const canGoPrev = urlState.offset > 0;
	const canGoNext = urlState.offset + PAGE_SIZE < totalCount;

	return (
		<div className="flex w-full flex-col gap-6 py-6">
			<header className="space-y-2">
				<h2 className="flex flex-row items-center gap-2 text-lg font-semibold tracking-tight">
					<UserRound className="size-4" />
					{t("aone.usersTitle")}
				</h2>
				<p className="text-muted-foreground max-w-2xl text-sm">
					{t("aone.usersDescription")}{" "}
					<code className="bg-muted rounded px-1.5 py-0.5 text-xs">{t("aone.usersDescriptionCode")}</code> {t("aone.usersDescriptionSuffix")}
				</p>
			</header>

			<div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative w-full max-w-md">
					<Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						data-testid="aone-users-search-input"
						className="pl-9"
						placeholder={t("aone.searchUsers")}
						value={urlState.search}
						onChange={(event) => {
							void setUrlState({ search: event.target.value, offset: 0 });
						}}
					/>
				</div>
				<div className="text-muted-foreground flex items-center gap-2 text-sm">
					<Users className="size-4 shrink-0" />
					<span>
						{totalCount === 1 ? t("aone.userCount", { count: totalCount }) : t("aone.usersCount", { count: totalCount })}
						{isFetching ? t("aone.refreshing") : ""}
					</span>
				</div>
			</div>

			{isLoading && (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<p className="text-muted-foreground text-sm">{t("aone.loadingUsers")}</p>
				</div>
			)}
			{isError && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
					{t("aone.loadUsersFailed", { message: getErrorMessage(error) })}
				</div>
			)}

			{!isLoading && !isError && users.length === 0 && (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<div className="bg-muted mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
						<Users className="text-muted-foreground size-5" />
					</div>
					<p className="text-sm font-medium">{t("aone.emptyUsersTitle")}</p>
					<p className="text-muted-foreground mt-1 text-sm">{t("aone.emptyUsersDescription")}</p>
				</div>
			)}

			{users.length > 0 && (
				<div className="overflow-hidden rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/40 hover:bg-muted/40">
								<TableHead className="pl-4">{t("aone.tableUser")}</TableHead>
								<TableHead>{t("aone.tableDepartment")}</TableHead>
								<TableHead>{t("aone.tableTitle")}</TableHead>
								<TableHead>{t("aone.tableStatus")}</TableHead>
								<TableHead>{t("aone.tableLastLogin")}</TableHead>
								<TableHead className="text-right">{t("aone.tableLogins")}</TableHead>
								<TableHead className="pr-4 text-right">{t("aone.tableEnabled")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{users.map((user) => (
								<AoneUserRow
									key={user.id}
									user={user}
									selected={urlState.selected_user === user.id}
									onSelect={() => {
										void setUrlState({ selected_user: user.id });
									}}
								/>
							))}
						</TableBody>
					</Table>
				</div>
			)}

			{totalCount > PAGE_SIZE && (
				<div className="flex items-center justify-between gap-4">
					<p className="text-muted-foreground text-sm">
						{t("aone.showingRange", {
							from: urlState.offset + 1,
							to: Math.min(urlState.offset + PAGE_SIZE, totalCount),
							total: totalCount,
						})}
					</p>
					<div className="flex gap-2">
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="aone-users-prev-page"
							disabled={!canGoPrev}
							onClick={() => {
								void setUrlState({ offset: Math.max(0, urlState.offset - PAGE_SIZE) });
							}}
						>
							<ChevronLeft className="size-4" />
							{t("aone.previous")}
						</Button>
						<Button
							type="button"
							variant="outline"
							size="sm"
							data-testid="aone-users-next-page"
							disabled={!canGoNext}
							onClick={() => {
								void setUrlState({ offset: urlState.offset + PAGE_SIZE });
							}}
						>
							{t("aone.next")}
							<ChevronRight className="size-4" />
						</Button>
					</div>
				</div>
			)}

			<AoneUserDetailSheet
				userId={urlState.selected_user}
				onClose={() => {
					void setUrlState({ selected_user: "" });
				}}
			/>
		</div>
	);
}

function AoneUserRow({ user, selected, onSelect }: { user: AoneUserListItem; selected: boolean; onSelect: () => void }) {
	const { locale } = useI18n();
	const t = useT();
	const displayName = resolveDisplayName(user);
	const avatar = resolveAvatar(user);

	return (
		<TableRow
			data-testid={`aone-user-row-${user.id}`}
			className={`cursor-pointer transition-colors ${selected ? "bg-muted/60 hover:bg-muted/60" : "hover:bg-muted/30"}`}
			onClick={onSelect}
		>
			<TableCell className="pl-4">
				<div className="flex items-center gap-3">
					<Avatar className="size-9 border">
						{avatar ? <AvatarImage src={avatar} alt={displayName} /> : null}
						<AvatarFallback>{userInitials(displayName)}</AvatarFallback>
					</Avatar>
					<div className="min-w-0">
						<p className="truncate text-sm font-medium">{displayName}</p>
						<p className="text-muted-foreground truncate font-mono text-xs">{user.id}</p>
					</div>
				</div>
			</TableCell>
			<TableCell>
				<div className="flex items-center gap-2">
					<Building2 className="text-muted-foreground size-4 shrink-0" />
					<span className="line-clamp-2 text-sm">{user.department_names || "-"}</span>
				</div>
			</TableCell>
			<TableCell className="text-sm">{user.job_title || "-"}</TableCell>
			<TableCell>
				<div className="flex flex-wrap gap-1.5">
					{user.is_disabled ? <Badge variant="destructive">{t("aone.disabled")}</Badge> : null}
					<Badge variant={user.status === "ACTIVE" ? "default" : "secondary"}>{aoneUserStatusLabel(t, user.status)}</Badge>
				</div>
			</TableCell>
			<TableCell className="text-sm">{formatRelativeTimeLocalized(user.last_login_at, locale)}</TableCell>
			<TableCell className="text-right text-sm tabular-nums">{user.login_count}</TableCell>
			<TableCell className="pr-4 text-right" onClick={(event) => event.stopPropagation()}>
				<AoneUserEnableSwitch user={user} />
			</TableCell>
		</TableRow>
	);
}

function AoneUserEnableSwitch({ user }: { user: AoneUserListItem }) {
	const t = useT();
	const [updateAoneUser, { isLoading }] = useUpdateAoneUserMutation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [nextEnabled, setNextEnabled] = useState(!user.is_disabled);

	const handleConfirm = async () => {
		try {
			await updateAoneUser({
				id: user.id,
				body: { is_disabled: !nextEnabled },
			}).unwrap();
			toast.success(nextEnabled ? t("aone.userEnabled") : t("aone.userDisabled"));
			setDialogOpen(false);
		} catch (mutationError) {
			toast.error(getErrorMessage(mutationError));
		}
	};

	return (
		<>
			<div className="flex items-center justify-end gap-2">
				<Switch
					checked={!user.is_disabled}
					disabled={isLoading}
					data-testid={`aone-user-enabled-switch-${user.id}`}
					aria-label={user.is_disabled ? t("aone.enableUserAria") : t("aone.disableUserAria")}
					onCheckedChange={(checked) => {
						setNextEnabled(checked);
						setDialogOpen(true);
					}}
				/>
			</div>
			<AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{nextEnabled ? t("aone.enableUser") : t("aone.disableUser")}</AlertDialogTitle>
						<AlertDialogDescription>
							{nextEnabled ? t("aone.enableDescription") : t("aone.disableDescription")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("governanceShared.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
								event.preventDefault();
								void handleConfirm();
							}}
							disabled={isLoading}
							className={nextEnabled ? undefined : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
						>
							{nextEnabled ? t("aone.enableUser") : t("aone.disableUser")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function AoneUserDetailSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
	const { locale } = useI18n();
	const t = useT();
	const { data, isLoading, isError, error } = useGetAoneUserQuery(userId, {
		skip: !userId,
	});
	const displayName = useMemo(() => {
		if (!data) {
			return "";
		}
		return data.dingtalk?.profile.name || data.user.display_name || data.user.name || data.user.id;
	}, [data]);

	const avatar = data?.dingtalk?.profile.avatar || data?.user.display_avatar || data?.user.avatar;
	const departments = data?.dingtalk?.departments ?? [];
	const departmentPath = departments
		.map((dept) => dept.name)
		.filter(Boolean)
		.join(" / ");

	return (
		<Sheet open={Boolean(userId)} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 pt-4 sm:max-w-lg" data-testid="aone-user-detail-sheet">
				<SheetHeader className="flex flex-col items-start px-6 pb-2" headerClassName="mb-0">
					<SheetTitle>{t("aone.detailTitle")}</SheetTitle>
					<SheetDescription>{t("aone.detailDescription")}</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
					{isLoading && (
						<div className="mt-4 rounded-lg border border-dashed p-8 text-center">
							<p className="text-muted-foreground text-sm">{t("aone.loadingUser")}</p>
						</div>
					)}
					{isError && (
						<div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
							{getErrorMessage(error)}
						</div>
					)}

					{data && (
						<div className="mt-4 space-y-4">
							<UserProfileHero data={data} displayName={displayName} avatar={avatar} departmentPath={departmentPath} />

							<DetailSection title={t("aone.sectionAccount")} icon={<ShieldCheck className="size-4" />}>
								<DetailRow label={t("aone.labelUserId")} value={data.user.id} mono />
								<DetailRow label={t("aone.labelLastLogin")} value={formatRelativeTimeLocalized(data.last_login_at, locale)} />
								<DetailRow label={t("aone.labelLoginCount")} value={String(data.login_count)} />
								<DetailRow label={t("aone.labelFirstSeen")} value={formatRelativeTimeLocalized(data.record_created_at, locale)} />
							</DetailSection>

							{data.dingtalk && (
								<DetailSection title={t("aone.sectionDingTalk")} icon={<Briefcase className="size-4" />}>
									<DetailRow label={t("aone.labelName")} value={data.dingtalk.profile.name} />
									<DetailRow label={t("aone.labelTitle")} value={data.dingtalk.profile.title} />
									<DetailRow label={t("aone.labelJobNumber")} value={data.dingtalk.profile.jobNumber} />
									<DetailRow label={t("aone.labelMobile")} value={data.dingtalk.profile.mobile} />
									<DetailRow label={t("aone.labelWorkplace")} value={data.dingtalk.profile.workPlace} />
									<DetailRow label={t("aone.labelTelephone")} value={data.dingtalk.profile.telephone} />
									<DetailRow
										label={t("aone.labelHiredDate")}
										value={formatDateShanghai(data.dingtalk.profile.hiredDate, locale)}
									/>
									<DetailRow
										label={t("aone.labelSyncedAt")}
										value={formatDateTimeShanghai(data.dingtalk.syncedAt, locale)}
									/>
								</DetailSection>
							)}

							{departments.length > 0 && (
								<DetailSection title={t("aone.sectionDepartments")} icon={<Building2 className="size-4" />}>
									{departmentPath ? <p className="text-muted-foreground mb-3 text-sm">{departmentPath}</p> : null}
									<div className="flex flex-wrap gap-2">
										{departments.map((dept) => (
											<Badge key={`${dept.deptId}-${dept.name}`} variant="secondary">
												{dept.name}
											</Badge>
										))}
									</div>
								</DetailSection>
							)}

							<MarketplaceUserAssignments userId={data.user.id} />

							{data.application && (
								<DetailSection title={t("aone.sectionApplication")} icon={<ShieldCheck className="size-4" />}>
									<div className="mb-3 flex items-center gap-3">
										{data.application.logo ? (
											<img src={data.application.logo} alt={data.application.name} className="size-10 rounded-md border object-cover" />
										) : (
											<div className="bg-muted flex size-10 items-center justify-center rounded-md border">
												<ShieldCheck className="text-muted-foreground size-4" />
											</div>
										)}
										<div>
											<p className="text-sm font-medium">{data.application.name}</p>
											<p className="text-muted-foreground text-xs">{data.application.id}</p>
										</div>
									</div>
									<DetailRow label={t("aone.labelApplicationId")} value={data.application.id} mono />
								</DetailSection>
							)}
						</div>
					)}
				</div>
			</SheetContent>
		</Sheet>
	);
}

function UserProfileHero({
	data,
	displayName,
	avatar,
	departmentPath,
}: {
	data: AoneUserDetailResponse;
	displayName: string;
	avatar?: string;
	departmentPath: string;
}) {
	const t = useT();
	return (
		<div className="bg-muted/40 rounded-xl border p-5">
			<div className="flex items-start gap-4">
				<Avatar className="border-background size-16 border-2 shadow-sm">
					{avatar ? <AvatarImage src={avatar} alt={displayName} /> : null}
					<AvatarFallback className="text-base">{userInitials(displayName)}</AvatarFallback>
				</Avatar>
				<div className="min-w-0 flex-1 space-y-2">
					<div>
						<p className="truncate text-lg font-semibold">{displayName}</p>
					</div>
					<div className="flex flex-wrap gap-2">
						{data.is_disabled ? <Badge variant="destructive">{t("aone.disabled")}</Badge> : null}
						<Badge variant={data.user.status === "ACTIVE" ? "default" : "secondary"}>{aoneUserStatusLabel(t, data.user.status)}</Badge>
						{data.dingtalk?.profile.title ? <Badge variant="outline">{data.dingtalk.profile.title}</Badge> : null}
					</div>
				</div>
			</div>

			{departmentPath ? (
				<>
					<Separator className="my-4" />
					<div className="flex items-start gap-2 text-sm">
						<Building2 className="text-muted-foreground mt-0.5 size-4 shrink-0" />
						<span className="text-muted-foreground leading-relaxed">{departmentPath}</span>
					</div>
				</>
			) : null}
		</div>
	);
}

function DetailSection({ title, icon, children }: { title: string; icon?: ReactNode; children: ReactNode }) {
	return (
		<section className="bg-background rounded-xl border p-4">
			<div className="mb-3 flex items-center gap-2">
				{icon ? <span className="text-muted-foreground">{icon}</span> : null}
				<h3 className="text-sm font-semibold">{title}</h3>
			</div>
			<div className="space-y-0">{children}</div>
		</section>
	);
}

function DetailRow({ label, value, mono }: { label: string; value?: string; mono?: boolean }) {
	if (!value) {
		return null;
	}
	return (
		<div className="grid grid-cols-[112px_1fr] gap-x-4 gap-y-1 border-b py-3 last:border-b-0">
			<dt className="text-muted-foreground text-sm">{label}</dt>
			<dd className={`text-sm break-all ${mono ? "font-mono text-xs" : ""}`}>{value}</dd>
		</div>
	);
}
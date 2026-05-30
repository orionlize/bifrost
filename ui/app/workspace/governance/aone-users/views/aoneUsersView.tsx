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
import { getErrorMessage } from "@/lib/store";
import {
	useGetAoneUserQuery,
	useListAoneUsersQuery,
	useRotateAoneUserApiKeyMutation,
	useUpdateAoneUserMutation,
} from "@/lib/store/apis/aoneUsersApi";
import type { AoneUserDetailResponse, AoneUserListItem } from "@/lib/types/aoneUser";
import { formatDistanceToNow } from "date-fns";
import {
	Briefcase,
	Building2,
	ChevronLeft,
	ChevronRight,
	Eye,
	EyeOff,
	KeyRound,
	RefreshCw,
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

function formatRelativeTime(value?: string) {
	if (!value) {
		return "-";
	}
	const date = new Date(value);
	if (Number.isNaN(date.getTime())) {
		return "-";
	}
	return formatDistanceToNow(date, { addSuffix: true });
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

function maskApiKey(key: string, revealed: boolean) {
	if (revealed) {
		return key;
	}
	return key.substring(0, 8) + "•".repeat(Math.max(0, key.length - 8));
}

export default function AoneUsersView() {
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
					Users
				</h2>
				<p className="text-muted-foreground max-w-2xl text-sm">
					Manage users who sign in through Aone OAuth. Profiles are synced from{" "}
					<code className="bg-muted rounded px-1.5 py-0.5 text-xs">/api/oauth2/me</code> on each login.
				</p>
			</header>

			<div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative w-full max-w-md">
					<Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						data-testid="aone-users-search-input"
						className="pl-9"
						placeholder="Search by name, department, or title..."
						value={urlState.search}
						onChange={(event) => {
							void setUrlState({ search: event.target.value, offset: 0 });
						}}
					/>
				</div>
				<div className="text-muted-foreground flex items-center gap-2 text-sm">
					<Users className="size-4 shrink-0" />
					<span>
						{totalCount} user{totalCount === 1 ? "" : "s"}
						{isFetching ? " · refreshing..." : ""}
					</span>
				</div>
			</div>

			{isLoading && (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<p className="text-muted-foreground text-sm">Loading users...</p>
				</div>
			)}
			{isError && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
					Failed to load users: {getErrorMessage(error)}
				</div>
			)}

			{!isLoading && !isError && users.length === 0 && (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<div className="bg-muted mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
						<Users className="text-muted-foreground size-5" />
					</div>
					<p className="text-sm font-medium">No Aone users yet</p>
					<p className="text-muted-foreground mt-1 text-sm">Users appear here after they sign in with Aone OAuth for the first time.</p>
				</div>
			)}

			{users.length > 0 && (
				<div className="overflow-hidden rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/40 hover:bg-muted/40">
								<TableHead className="pl-4">User</TableHead>
								<TableHead>Department</TableHead>
								<TableHead>Title</TableHead>
								<TableHead>Status</TableHead>
								<TableHead>Last login</TableHead>
								<TableHead className="text-right">Logins</TableHead>
								<TableHead className="pr-4 text-right">Enabled</TableHead>
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
						Showing {urlState.offset + 1}-{Math.min(urlState.offset + PAGE_SIZE, totalCount)} of {totalCount}
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
							Previous
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
							Next
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
					{user.is_disabled ? <Badge variant="destructive">Disabled</Badge> : null}
					<Badge variant={user.status === "ACTIVE" ? "default" : "secondary"}>{user.status || "UNKNOWN"}</Badge>
				</div>
			</TableCell>
			<TableCell className="text-sm">{formatRelativeTime(user.last_login_at)}</TableCell>
			<TableCell className="text-right text-sm tabular-nums">{user.login_count}</TableCell>
			<TableCell className="pr-4 text-right" onClick={(event) => event.stopPropagation()}>
				<AoneUserEnableSwitch user={user} />
			</TableCell>
		</TableRow>
	);
}

function AoneUserEnableSwitch({ user }: { user: AoneUserListItem }) {
	const [updateAoneUser, { isLoading }] = useUpdateAoneUserMutation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [nextEnabled, setNextEnabled] = useState(!user.is_disabled);

	const handleConfirm = async () => {
		try {
			await updateAoneUser({
				id: user.id,
				body: { is_disabled: !nextEnabled },
			}).unwrap();
			toast.success(nextEnabled ? "User enabled" : "User disabled");
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
					aria-label={user.is_disabled ? "Enable user" : "Disable user"}
					onCheckedChange={(checked) => {
						setNextEnabled(checked);
						setDialogOpen(true);
					}}
				/>
			</div>
			<AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{nextEnabled ? "Enable user" : "Disable user"}</AlertDialogTitle>
						<AlertDialogDescription>
							{nextEnabled
								? "This will allow the user to sign in again and reactivate their personal API key."
								: "This will block sign-in, clear active sessions, and deactivate the user's personal API key."}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>Cancel</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
								event.preventDefault();
								void handleConfirm();
							}}
							disabled={isLoading}
							className={nextEnabled ? undefined : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
						>
							{nextEnabled ? "Enable user" : "Disable user"}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}

function AoneUserDetailSheet({ userId, onClose }: { userId: string; onClose: () => void }) {
	const { data, isLoading, isError, error } = useGetAoneUserQuery(userId, {
		skip: !userId,
	});
	const [rotateApiKey, { isLoading: isRotatingApiKey }] = useRotateAoneUserApiKeyMutation();
	const [apiKeyRevealed, setApiKeyRevealed] = useState(false);

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

	const handleRotateApiKey = async () => {
		if (!data) {
			return;
		}
		try {
			await rotateApiKey(data.user.id).unwrap();
			setApiKeyRevealed(true);
			toast.success("API key refreshed");
		} catch (mutationError) {
			toast.error(getErrorMessage(mutationError));
		}
	};

	return (
		<Sheet open={Boolean(userId)} onOpenChange={(open) => !open && onClose()}>
			<SheetContent className="flex w-full flex-col gap-0 overflow-hidden p-0 pt-4 sm:max-w-lg" data-testid="aone-user-detail-sheet">
				<SheetHeader className="flex flex-col items-start px-6 pb-2" headerClassName="mb-0">
					<SheetTitle>User details</SheetTitle>
					<SheetDescription>Aone OAuth profile synced from the identity provider.</SheetDescription>
				</SheetHeader>

				<div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-6 pb-6">
					{isLoading && (
						<div className="mt-4 rounded-lg border border-dashed p-8 text-center">
							<p className="text-muted-foreground text-sm">Loading user...</p>
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

							<DetailSection title="API access" icon={<KeyRound className="size-4" />}>
								{data.api_key ? (
									<div className="space-y-3">
										<div className="flex flex-wrap items-center gap-2">
											<Badge variant={data.api_key_active ? "default" : "secondary"}>{data.api_key_active ? "Active" : "Inactive"}</Badge>
											{data.is_disabled ? <Badge variant="destructive">User disabled</Badge> : null}
										</div>
										<div className="flex items-center gap-2">
											<code
												className="bg-muted flex-1 rounded-md px-3 py-2 font-mono text-xs break-all"
												data-testid="aone-user-api-key-value"
											>
												{maskApiKey(data.api_key, apiKeyRevealed)}
											</code>
											<Button
												type="button"
												variant="outline"
												size="icon"
												className="shrink-0"
												data-testid="aone-user-api-key-toggle"
												onClick={() => setApiKeyRevealed((prev) => !prev)}
												aria-label={apiKeyRevealed ? "Hide API key" : "Show API key"}
											>
												{apiKeyRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
											</Button>
											<Button
												type="button"
												variant="outline"
												size="icon"
												className="shrink-0"
												data-testid="aone-user-rotate-api-key-btn"
												disabled={isRotatingApiKey || data.is_disabled}
												onClick={() => void handleRotateApiKey()}
												aria-label="Refresh API key"
												title="Refresh API key"
											>
												<RefreshCw className={`size-4 ${isRotatingApiKey ? "animate-spin" : ""}`} />
											</Button>
										</div>
									</div>
								) : (
									<p className="text-muted-foreground text-sm">No API key has been provisioned for this user yet.</p>
								)}
							</DetailSection>

							<DetailSection title="Account" icon={<ShieldCheck className="size-4" />}>
								<DetailRow label="User ID" value={data.user.id} mono />
								<DetailRow label="Last login" value={formatRelativeTime(data.last_login_at)} />
								<DetailRow label="Login count" value={String(data.login_count)} />
								<DetailRow label="First seen" value={formatRelativeTime(data.record_created_at)} />
							</DetailSection>

							{data.dingtalk && (
								<DetailSection title="DingTalk profile" icon={<Briefcase className="size-4" />}>
									<DetailRow label="Name" value={data.dingtalk.profile.name} />
									<DetailRow label="Title" value={data.dingtalk.profile.title} />
									<DetailRow label="Job number" value={data.dingtalk.profile.jobNumber} />
									<DetailRow label="Mobile" value={data.dingtalk.profile.mobile} />
									<DetailRow label="Workplace" value={data.dingtalk.profile.workPlace} />
									<DetailRow label="Telephone" value={data.dingtalk.profile.telephone} />
									<DetailRow label="Hired date" value={data.dingtalk.profile.hiredDate} />
									<DetailRow label="Synced at" value={formatRelativeTime(data.dingtalk.syncedAt)} />
								</DetailSection>
							)}

							{departments.length > 0 && (
								<DetailSection title="Departments" icon={<Building2 className="size-4" />}>
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

							{data.application && (
								<DetailSection title="Application" icon={<ShieldCheck className="size-4" />}>
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
									<DetailRow label="Application ID" value={data.application.id} mono />
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
						{data.is_disabled ? <Badge variant="destructive">Disabled</Badge> : null}
						<Badge variant={data.user.status === "ACTIVE" ? "default" : "secondary"}>{data.user.status}</Badge>
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
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useDebouncedValue } from "@/hooks/useDebounce";
import { useT } from "@/lib/i18n";
import { getErrorMessage } from "@/lib/store";
import { useListAoneDevicesQuery, useUpdateAoneDeviceMutation } from "@/lib/store/apis/aoneDevicesApi";
import type { AoneDeviceListItem } from "@/lib/types/aoneDevice";
import { formatDistanceToNow } from "date-fns";
import { ChevronLeft, ChevronRight, Laptop, Search } from "lucide-react";
import { parseAsInteger, parseAsString, useQueryStates } from "nuqs";
import { useState } from "react";
import { toast } from "sonner";

const PAGE_SIZE = 25;

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

function truncateFingerprint(value: string, head = 18, tail = 8) {
	if (value.length <= head + tail + 3) {
		return value;
	}
	return `${value.slice(0, head)}...${value.slice(-tail)}`;
}

export default function AoneDevicesView() {
	const t = useT();
	const [urlState, setUrlState] = useQueryStates(
		{
			search: parseAsString.withDefault(""),
			offset: parseAsInteger.withDefault(0),
		},
		{ history: "push" },
	);

	const debouncedSearch = useDebouncedValue(urlState.search, 300);

	const { data, isLoading, isError, error, isFetching } = useListAoneDevicesQuery({
		limit: PAGE_SIZE,
		offset: urlState.offset,
		search: debouncedSearch || undefined,
	});

	const devices = data?.devices ?? [];
	const totalCount = data?.total_count ?? 0;
	const canGoPrev = urlState.offset > 0;
	const canGoNext = urlState.offset + PAGE_SIZE < totalCount;

	return (
		<div className="flex w-full flex-col gap-6 py-6">
			<header className="space-y-2">
				<h2 className="flex flex-row items-center gap-2 text-lg font-semibold tracking-tight">
					<Laptop className="size-4" />
					{t("aone.devicesTitle")}
				</h2>
				<p className="text-muted-foreground max-w-2xl text-sm">{t("aone.devicesDescription")}</p>
			</header>

			<div className="flex flex-col gap-4 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="relative w-full max-w-md">
					<Search className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2" />
					<Input
						data-testid="aone-devices-search-input"
						className="pl-9"
						placeholder={t("aone.searchDevices")}
						value={urlState.search}
						onChange={(event) => {
							void setUrlState({ search: event.target.value, offset: 0 });
						}}
					/>
				</div>
				<div className="text-muted-foreground flex items-center gap-2 text-sm">
					<Laptop className="size-4 shrink-0" />
					<span>
						{totalCount === 1 ? t("aone.deviceCount", { count: totalCount }) : t("aone.devicesCount", { count: totalCount })}
						{isFetching ? t("aone.refreshing") : ""}
					</span>
				</div>
			</div>

			{isLoading && (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<p className="text-muted-foreground text-sm">{t("aone.loadingDevices")}</p>
				</div>
			)}
			{isError && (
				<div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-600 dark:border-red-900/40 dark:bg-red-950/20 dark:text-red-400">
					{t("aone.loadDevicesFailed", { message: getErrorMessage(error) })}
				</div>
			)}

			{!isLoading && !isError && devices.length === 0 && (
				<div className="rounded-lg border border-dashed p-10 text-center">
					<div className="bg-muted mx-auto mb-4 flex size-12 items-center justify-center rounded-full">
						<Laptop className="text-muted-foreground size-5" />
					</div>
					<p className="text-sm font-medium">{t("aone.emptyDevicesTitle")}</p>
					<p className="text-muted-foreground mt-1 text-sm">{t("aone.emptyDevicesDescription")}</p>
				</div>
			)}

			{devices.length > 0 && (
				<div className="overflow-hidden rounded-lg border">
					<Table>
						<TableHeader>
							<TableRow className="bg-muted/40 hover:bg-muted/40">
								<TableHead className="pl-4">{t("aone.tableFingerprint")}</TableHead>
								<TableHead>{t("aone.tableDevice")}</TableHead>
								<TableHead>{t("aone.tableUserCol")}</TableHead>
								<TableHead>{t("aone.tableDeviceStatus")}</TableHead>
								<TableHead>{t("aone.tableLastApiAccess")}</TableHead>
								<TableHead className="pr-4 text-right">{t("aone.tableDeviceEnabled")}</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{devices.map((device) => (
								<AoneDeviceRow key={device.id} device={device} />
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
							data-testid="aone-devices-prev-page"
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
							data-testid="aone-devices-next-page"
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
		</div>
	);
}

function AoneDeviceRow({ device }: { device: AoneDeviceListItem }) {
	const t = useT();
	const userLabel = device.user_display_name || device.aone_user_id;

	return (
		<TableRow data-testid={`aone-device-row-${device.id}`}>
			<TableCell className="pl-4">
				<div className="min-w-0">
					<code
						className="bg-muted block max-w-[280px] truncate rounded px-2 py-1 font-mono text-xs"
						title={device.device_fingerprint}
						data-testid={`aone-device-fingerprint-${device.id}`}
					>
						{truncateFingerprint(device.device_fingerprint)}
					</code>
				</div>
			</TableCell>
			<TableCell className="text-sm">{device.device_name || "-"}</TableCell>
			<TableCell>
				<div className="min-w-0">
					<p className="truncate text-sm font-medium">{userLabel}</p>
					<p className="text-muted-foreground truncate font-mono text-xs">{device.aone_user_id}</p>
				</div>
			</TableCell>
			<TableCell>
				<Badge variant={device.is_active ? "default" : "secondary"} data-testid={`aone-device-status-${device.id}`}>
					{device.is_active ? t("aone.statusActive") : t("aone.statusRevoked")}
				</Badge>
			</TableCell>
			<TableCell className="text-sm">{formatRelativeTime(device.last_api_access_at)}</TableCell>
			<TableCell className="pr-4 text-right">
				<AoneDeviceEnableSwitch device={device} />
			</TableCell>
		</TableRow>
	);
}

function AoneDeviceEnableSwitch({ device }: { device: AoneDeviceListItem }) {
	const t = useT();
	const [updateDevice, { isLoading }] = useUpdateAoneDeviceMutation();
	const [dialogOpen, setDialogOpen] = useState(false);
	const [nextEnabled, setNextEnabled] = useState(device.is_active);

	const handleConfirm = async () => {
		try {
			await updateDevice({
				id: device.id,
				body: { is_active: nextEnabled },
			}).unwrap();
			toast.success(nextEnabled ? t("aone.deviceEnabled") : t("aone.deviceDisabled"));
			setDialogOpen(false);
		} catch (mutationError) {
			toast.error(getErrorMessage(mutationError));
		}
	};

	return (
		<>
			<div className="flex items-center justify-end gap-2">
				<Switch
					checked={device.is_active}
					disabled={isLoading}
					data-testid={`aone-device-enabled-switch-${device.id}`}
					aria-label={device.is_active ? t("aone.disableDeviceAria") : t("aone.enableDeviceAria")}
					onCheckedChange={(checked) => {
						setNextEnabled(checked);
						setDialogOpen(true);
					}}
				/>
			</div>
			<AlertDialog open={dialogOpen} onOpenChange={setDialogOpen}>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>{nextEnabled ? t("aone.enableDevice") : t("aone.disableDevice")}</AlertDialogTitle>
						<AlertDialogDescription>
							{nextEnabled ? t("aone.enableDeviceDescription") : t("aone.disableDeviceDescription")}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel>{t("governanceShared.cancel")}</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void handleConfirm();
							}}
							disabled={isLoading}
							className={nextEnabled ? undefined : "bg-destructive text-destructive-foreground hover:bg-destructive/90"}
						>
							{nextEnabled ? t("aone.enableDevice") : t("aone.disableDevice")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</>
	);
}
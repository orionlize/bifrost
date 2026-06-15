import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { getErrorMessage } from "@/lib/store";
import { useListFeatureFlagsQuery, useUpdateFeatureFlagMutation } from "@/lib/store/apis/featureFlagsApi";
import type { FeatureFlagStatus } from "@/lib/types/featureFlag";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { Crown, Flag, Lock } from "lucide-react";
import { toast } from "sonner";
import { FeatureFlagsEmptyState } from "./featureFlagsEmptyState";

export default function FeatureFlagsView() {
	const t = useT();
	const hasUpdateAccess = useRbac(RbacResource.FeatureFlags, RbacOperation.Update);
	const { data, isLoading, isError, error } = useListFeatureFlagsQuery();
	const [updateFeatureFlag] = useUpdateFeatureFlagMutation();

	const flags = data?.flags ?? [];

	async function handleToggle(flag: FeatureFlagStatus, checked: boolean) {
		try {
			await updateFeatureFlag({ id: flag.id, enabled: checked }).unwrap();
			toast.success(
				t("configViews.featureFlags.toggleSuccess", {
					name: flag.display_name || flag.id,
					state: checked ? t("configViews.featureFlags.enabled") : t("configViews.featureFlags.disabled"),
				}),
			);
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	}

	return (
		<div className="flex w-full flex-col gap-6 py-6">
			<header className="space-y-1">
				<h2 className="flex flex-row items-center gap-1 text-lg font-semibold tracking-tight">
					<Flag className="size-4" />
					{t("configPages.featureFlagsTitle")}
				</h2>
				<p className="text-muted-foreground text-sm">{t("configPages.featureFlagsDesc")}</p>
			</header>

			{isLoading && <p className="text-muted-foreground text-sm">{t("configPages.loadingFeatureFlags")}</p>}
			{isError && <p className="text-sm text-red-500">{t("configViews.featureFlags.loadFailed", { message: getErrorMessage(error) })}</p>}

			{!isLoading && !isError && flags.length === 0 && <FeatureFlagsEmptyState />}

			{flags.length > 0 && (
				<div className="rounded-md border">
					<Table>
						<TableBody>
							{flags.map((flag) => (
								<FeatureFlagRow key={flag.id} flag={flag} canUpdate={hasUpdateAccess} onToggle={handleToggle} />
							))}
						</TableBody>
					</Table>
				</div>
			)}
		</div>
	);
}

interface FeatureFlagRowProps {
	flag: FeatureFlagStatus;
	canUpdate: boolean;
	onToggle: (flag: FeatureFlagStatus, checked: boolean) => Promise<void>;
}

function FeatureFlagRow({ flag, canUpdate, onToggle }: FeatureFlagRowProps) {
	const t = useT();
	const disabled = flag.locked || !flag.registered || !canUpdate;
	const primaryLabel = flag.display_name || flag.id;

	return (
		<TableRow>
			<TableCell className="align-top">
				<div className="flex flex-col gap-1">
					<div className="flex flex-wrap items-center gap-2">
						<span className="text-sm font-medium">{primaryLabel}</span>
						{flag.display_name && <span className="text-muted-foreground font-mono text-xs">{flag.id}</span>}
						<SourceBadge source={flag.source} />
						{flag.enterprise_only && <EnterpriseBadge />}
						{flag.locked && !flag.enterprise_only && <LockedBadge />}
						{!flag.registered && <UnregisteredBadge />}
					</div>
					{flag.description && <p className="text-muted-foreground text-sm">{flag.description}</p>}
					{!flag.registered && <p className="text-muted-foreground text-xs">{t("configViews.featureFlags.unregisteredHint")}</p>}
				</div>
			</TableCell>
			<TableCell className="w-px align-top">
				<Switch
					data-testid={`feature-flag-toggle-${flag.id}`}
					size="md"
					checked={flag.enabled}
					disabled={disabled}
					onAsyncCheckedChange={(checked) => onToggle(flag, checked)}
				/>
			</TableCell>
		</TableRow>
	);
}

function SourceBadge({ source }: { source: FeatureFlagStatus["source"] }) {
	return (
		<Badge variant="outline" className="text-xs capitalize">
			{source}
		</Badge>
	);
}

function LockedBadge() {
	const t = useT();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant="secondary" className="flex items-center gap-1 text-xs">
					<Lock className="size-3" />
					{t("configViews.shared.locked")}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>{t("configViews.featureFlags.lockedTooltip")}</TooltipContent>
		</Tooltip>
	);
}

function EnterpriseBadge() {
	const t = useT();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant="secondary" className="flex items-center gap-1 text-xs">
					<Crown className="size-3" />
					{t("configViews.shared.enterprise")}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>{t("configViews.featureFlags.enterpriseTooltip")}</TooltipContent>
		</Tooltip>
	);
}

function UnregisteredBadge() {
	const t = useT();
	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<Badge variant="destructive" className="text-xs">
					{t("configViews.shared.unregistered")}
				</Badge>
			</TooltipTrigger>
			<TooltipContent>{t("configViews.featureFlags.unregisteredTooltip")}</TooltipContent>
		</Tooltip>
	);
}
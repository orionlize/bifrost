import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { getErrorMessage, useGetCoreConfigQuery, useUpdateCoreConfigMutation } from "@/lib/store";
import { CoreConfig, DefaultCoreConfig } from "@/lib/types/config";
import { parseArrayFromText } from "@/lib/utils/array";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { useT } from "@/lib/i18n";
import { useNavDescription, useNavTitle } from "@/lib/i18n/useNavTitle";
import { AlertTriangle } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export default function ObservabilityView() {
	const t = useT();
	const pageTitle = useNavTitle("connectors");
	const pageDescription = useNavDescription("connectors");
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });
	const config = bifrostConfig?.client_config;
	const [updateCoreConfig, { isLoading }] = useUpdateCoreConfigMutation();
	const [localConfig, setLocalConfig] = useState<CoreConfig>(DefaultCoreConfig);
	const [needsRestart, setNeedsRestart] = useState<boolean>(false);

	const [localValues, setLocalValues] = useState<{
		prometheus_labels: string;
	}>({
		prometheus_labels: "",
	});

	useEffect(() => {
		if (bifrostConfig && config) {
			setLocalConfig(config);
			setLocalValues({
				prometheus_labels: config?.prometheus_labels?.join(", ") || "",
			});
		}
	}, [config, bifrostConfig]);

	const hasChanges = useMemo(() => {
		if (!config) return false;
		const localLabels = localConfig.prometheus_labels.slice().sort().join(",");
		const serverLabels = config.prometheus_labels.slice().sort().join(",");
		return localLabels !== serverLabels;
	}, [config, localConfig]);

	const handlePrometheusLabelsChange = useCallback((value: string) => {
		setLocalValues((prev) => ({ ...prev, prometheus_labels: value }));
		setLocalConfig((prev) => ({ ...prev, prometheus_labels: parseArrayFromText(value) }));
		setNeedsRestart(true);
	}, []);

	const handleSave = useCallback(async () => {
		if (!bifrostConfig) {
			toast.error(t("configViews.shared.couldNotSaveNotLoaded"));
			return;
		}
		try {
			await updateCoreConfig({ ...bifrostConfig, client_config: localConfig }).unwrap();
			toast.success(t("configViews.observability.updated"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	}, [bifrostConfig, localConfig, updateCoreConfig, t]);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-4">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">{pageTitle}</h2>
				<p className="text-muted-foreground text-sm">{pageDescription}</p>
			</div>

			<Alert variant="destructive">
				<AlertTriangle className="h-4 w-4" />
				<AlertDescription>{t("configViews.shared.restartRequiredAlert")}</AlertDescription>
			</Alert>

			<div className="space-y-4">
				<div>
					<div className="space-y-2 rounded-lg border p-4">
						<div className="space-y-0.5">
							<label htmlFor="prometheus-labels" className="text-sm font-medium">
								{t("configViews.observability.prometheusLabels")}
							</label>
							<p className="text-muted-foreground text-sm">{t("configViews.observability.prometheusLabelsDesc")}</p>
						</div>
						<Textarea
							id="prometheus-labels"
							className="h-24"
							placeholder={t("configViews.observability.prometheusLabelsPlaceholder")}
							value={localValues.prometheus_labels}
							onChange={(e) => handlePrometheusLabelsChange(e.target.value)}
						/>
					</div>
					{needsRestart && <RestartWarning />}
				</div>
			</div>
			<div className="flex justify-end pt-2">
				<Button onClick={handleSave} disabled={!hasChanges || isLoading || !hasSettingsUpdateAccess}>
					{isLoading ? t("common.actions.saving") : t("common.actions.saveChanges")}
				</Button>
			</div>
		</div>
	);
}

const RestartWarning = () => {
	const t = useT();
	return <div className="text-muted-foreground mt-2 pl-4 text-xs font-semibold">{t("configCommon.restartHint")}</div>;
};

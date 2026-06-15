import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, useForcePricingSyncMutation, useGetCoreConfigQuery, useUpdateCoreConfigMutation } from "@/lib/store";
import { useT } from "@/lib/i18n";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { useEffect, useMemo } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

interface PricingFormData {
	pricing_datasheet_url: string;
	pricing_sync_interval_hours: number;
	model_parameters_url: string;
}

export default function PricingConfigView() {
	const t = useT();
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });
	const config = bifrostConfig?.framework_config;
	const [updateCoreConfig, { isLoading }] = useUpdateCoreConfigMutation();
	const [forcePricingSync, { isLoading: isForceSyncing }] = useForcePricingSyncMutation();

	const {
		register,
		handleSubmit,
		formState: { errors, isDirty },
		reset,
		watch,
	} = useForm<PricingFormData>({
		defaultValues: {
			pricing_datasheet_url: "",
			pricing_sync_interval_hours: 24,
			model_parameters_url: "",
		},
	});

	const formValues = watch();

	useEffect(() => {
		if (bifrostConfig && config) {
			reset({
				pricing_datasheet_url: config.pricing_url || "",
				pricing_sync_interval_hours: Math.round(config.pricing_sync_interval / 3600) || 24,
				model_parameters_url: config.model_parameters_url || "",
			});
		}
	}, [config, bifrostConfig, reset]);

	const hasChanges = useMemo(() => {
		if (!config || !isDirty) return false;
		const serverUrl = config.pricing_url || "";
		const serverInterval = Math.round(config.pricing_sync_interval / 3600);
		const serverModelParamsUrl = config.model_parameters_url || "";
		return (
			formValues.pricing_datasheet_url !== serverUrl ||
			formValues.pricing_sync_interval_hours !== serverInterval ||
			formValues.model_parameters_url !== serverModelParamsUrl
		);
	}, [config, formValues, isDirty]);

	const onSubmit = async (data: PricingFormData) => {
		try {
			await updateCoreConfig({
				...bifrostConfig!,
				framework_config: {
					...config,
					id: bifrostConfig?.framework_config.id || 0,
					pricing_url: data.pricing_datasheet_url,
					pricing_sync_interval: data.pricing_sync_interval_hours * 3600,
					model_parameters_url: data.model_parameters_url,
				},
			}).unwrap();
			toast.success(t("configViews.pricing.updated"));
			reset(data);
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const handleForceSync = async () => {
		try {
			await forcePricingSync().unwrap();
			toast.success(t("configViews.pricing.syncTriggered"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	return (
		<div className="mx-auto w-full max-w-7xl space-y-4" data-testid="pricing-config-view">
			<form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
				<div>
					<h2 className="text-lg font-semibold tracking-tight">{t("configPages.pricingConfiguration")}</h2>
					<p className="text-muted-foreground text-sm">{t("configViews.pricing.description")}</p>
				</div>

				<div className="space-y-4">
					<div className="space-y-2 rounded-sm border p-4">
						<div className="space-y-0.5">
							<Label htmlFor="pricing-datasheet-url">{t("configViews.pricing.pricingDatasheetUrl")}</Label>
							<p className="text-muted-foreground text-sm">{t("configViews.pricing.pricingDatasheetUrlDesc")}</p>
						</div>
						<Input
							id="pricing-datasheet-url"
							type="text"
							placeholder={t("configViews.pricing.pricingDatasheetPlaceholder")}
							data-testid="pricing-datasheet-url-input"
							{...register("pricing_datasheet_url", {
								pattern: {
									value: /^(https?:\/\/)?((localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?|([\da-z\.-]+)\.([a-z\.]{2,6}))([\/\w \.-]*)*\/?$/,
									message: t("configViews.shared.invalidUrl"),
								},
								validate: {
									checkIfHttp: (value) => {
										if (!value) return true;
										return value.startsWith("http://") || value.startsWith("https://") || t("configViews.shared.urlMustStartWithHttp");
									},
								},
							})}
							className={errors.pricing_datasheet_url ? "border-destructive" : ""}
						/>
						{errors.pricing_datasheet_url && <p className="text-destructive text-sm">{errors.pricing_datasheet_url.message}</p>}
					</div>

					<div className="space-y-2 rounded-sm border p-4">
						<div className="space-y-0.5">
							<Label htmlFor="model-parameters-url">{t("configViews.pricing.modelParametersUrl")}</Label>
							<p className="text-muted-foreground text-sm">{t("configViews.pricing.modelParametersUrlDesc")}</p>
						</div>
						<Input
							id="model-parameters-url"
							type="text"
							placeholder={t("configViews.pricing.modelParametersPlaceholder")}
							data-testid="model-parameters-url-input"
							{...register("model_parameters_url", {
								pattern: {
									value: /^(https?:\/\/)?((localhost|(\d{1,3}\.){3}\d{1,3})(:\d+)?|([\da-z\.-]+)\.([a-z\.]{2,6}))([\/\w \.-]*)*\/?$/,
									message: t("configViews.shared.invalidUrl"),
								},
								validate: {
									checkIfHttp: (value) => {
										if (!value) return true;
										return value.startsWith("http://") || value.startsWith("https://") || t("configViews.shared.urlMustStartWithHttp");
									},
								},
							})}
							className={errors.model_parameters_url ? "border-destructive" : ""}
						/>
						{errors.model_parameters_url && <p className="text-destructive text-sm">{errors.model_parameters_url.message}</p>}
					</div>

					<div className="space-y-2 rounded-sm border p-4">
						<div className="space-y-2">
							<div className="space-y-0.5">
								<Label htmlFor="pricing-sync-interval">{t("configViews.pricing.syncIntervalHours")}</Label>
								<p className="text-muted-foreground text-sm">{t("configViews.pricing.syncIntervalDesc")}</p>
							</div>
							<Input
								id="pricing-sync-interval"
								type="number"
								className={errors.pricing_sync_interval_hours ? "border-destructive" : ""}
								{...register("pricing_sync_interval_hours", {
									required: t("configViews.pricing.syncIntervalRequired"),
									min: {
										value: 1,
										message: t("configViews.pricing.syncIntervalMin"),
									},
									max: {
										value: 8760,
										message: t("configViews.pricing.syncIntervalMax"),
									},
									valueAsNumber: true,
								})}
							/>
							{errors.pricing_sync_interval_hours && (
								<p className="text-destructive text-sm">{errors.pricing_sync_interval_hours.message}</p>
							)}
						</div>
					</div>
				</div>
				<div className="flex justify-end gap-2 pt-2">
					<Button
						variant="outline"
						type="button"
						onClick={handleForceSync}
						disabled={isForceSyncing || !hasSettingsUpdateAccess}
						data-testid="pricing-force-sync-btn"
					>
						{isForceSyncing ? t("configViews.shared.syncing") : t("configViews.shared.forceSyncNow")}
					</Button>
					<Button type="submit" disabled={!hasChanges || isLoading || !hasSettingsUpdateAccess} data-testid="pricing-save-btn">
						{isLoading ? t("common.actions.saving") : t("common.actions.saveChanges")}
					</Button>
				</div>
			</form>
		</div>
	);
}
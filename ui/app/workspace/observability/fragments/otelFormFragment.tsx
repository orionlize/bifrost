import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnvVarInput } from "@/components/ui/envVarInput";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { HeadersTable } from "@/components/ui/headersTable";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { otelFormSchema, type EnvVar, type OtelFormSchema } from "@/lib/types/schemas";
import { toEnvVarFormValue, toEnvVarMapFormValue } from "@/lib/utils/envVarForm";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useForm, type Resolver } from "react-hook-form";

interface OtelFormFragmentProps {
	currentConfig?: {
		enabled?: boolean;
		service_name?: string;
		collector_url?: string | EnvVar;
		headers?: Record<string, string | EnvVar>;
		trace_type?: "genai_extension" | "vercel" | "open_inference";
		protocol?: "http" | "grpc";
		// TLS configuration
		tls_ca_cert?: string;
		insecure?: boolean;
		// Metrics push configuration
		metrics_enabled?: boolean;
		metrics_endpoint?: string | EnvVar;
		metrics_push_interval?: number;
	};
	onSave: (config: OtelFormSchema) => Promise<void>;
	onDelete?: () => void;
	isDeleting?: boolean;
	isLoading?: boolean;
}

const buildDefaults = (initialConfig?: OtelFormFragmentProps["currentConfig"]): OtelFormSchema => ({
	enabled: initialConfig?.enabled ?? true,
	otel_config: {
		service_name: initialConfig?.service_name ?? "bifrost",
		collector_url: toEnvVarFormValue(initialConfig?.collector_url),
		headers: toEnvVarMapFormValue(initialConfig?.headers),
		trace_type: initialConfig?.trace_type ?? "genai_extension",
		protocol: initialConfig?.protocol ?? "http",
		tls_ca_cert: initialConfig?.tls_ca_cert ?? "",
		insecure: initialConfig?.insecure ?? true,
		metrics_enabled: initialConfig?.metrics_enabled ?? false,
		metrics_endpoint: toEnvVarFormValue(initialConfig?.metrics_endpoint),
		metrics_push_interval: initialConfig?.metrics_push_interval ?? 15,
	},
});

export function OtelFormFragment({
	currentConfig: initialConfig,
	onSave,
	onDelete,
	isDeleting = false,
	isLoading = false,
}: OtelFormFragmentProps) {
	const t = useT();
	const hasOtelAccess = useRbac(RbacResource.Observability, RbacOperation.Update);
	const [isSaving, setIsSaving] = useState(false);
	const form = useForm<OtelFormSchema, any, OtelFormSchema>({
		resolver: zodResolver(otelFormSchema) as Resolver<OtelFormSchema, any, OtelFormSchema>,
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: buildDefaults(initialConfig),
	});

	const onSubmit = (data: OtelFormSchema) => {
		setIsSaving(true);
		onSave(data).finally(() => setIsSaving(false));
	};

	// Re-run validation on collector_url when protocol changes so cross-field
	// refinement in the schema is applied immediately
	const protocol = form.watch("otel_config.protocol");
	const metricsEnabled = form.watch("otel_config.metrics_enabled");
	useEffect(() => {
		if (form.getValues("enabled") === false) return;
		form.trigger("otel_config.collector_url");
		// Also re-validate metrics_endpoint when protocol changes
		if (metricsEnabled) {
			form.trigger("otel_config.metrics_endpoint");
		}
	}, [protocol, form, metricsEnabled]);

	// Re-run validation on metrics_endpoint when metrics_enabled changes
	useEffect(() => {
		if (metricsEnabled) {
			form.trigger("otel_config.metrics_endpoint");
		}
	}, [metricsEnabled, form]);

	useEffect(() => {
		form.reset(buildDefaults(initialConfig));
	}, [form, initialConfig]);

	const traceTypeOptions: { value: string; label: string; disabled?: boolean; disabledReason?: string }[] = [
		{ value: "genai_extension", label: t("observabilityConnectors.otel.traceTypes.genai") },
		{ value: "vercel", label: t("observabilityConnectors.otel.traceTypes.vercel"), disabled: true, disabledReason: t("observabilityConnectors.comingSoon") },
		{ value: "open_inference", label: t("observabilityConnectors.otel.traceTypes.openInference"), disabled: true, disabledReason: t("observabilityConnectors.comingSoon") },
	];
	const protocolOptions: { value: string; label: string }[] = [
		{ value: "http", label: t("observabilityConnectors.otel.protocolHttp") },
		{ value: "grpc", label: t("observabilityConnectors.otel.protocolGrpc") },
	];

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
				{/* OTEL Configuration */}
				<div className="space-y-4">
					<div className="flex flex-col gap-4">
						<FormField
							control={form.control}
							name="otel_config.service_name"
							render={({ field }) => (
								<FormItem className="w-full">
									<FormLabel>{t("observabilityConnectors.otel.serviceName")}</FormLabel>
									<FormDescription>{t("observabilityConnectors.otel.serviceNameEmptyDesc")}</FormDescription>
									<FormControl>
										<Input placeholder={t("observabilityConnectors.otel.serviceNamePlaceholder")} disabled={!hasOtelAccess} {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="otel_config.collector_url"
							render={({ field }) => (
								<FormItem className="w-full">
									<FormLabel>{t("observabilityConnectors.otel.collectorUrl")}</FormLabel>
									<div className="text-muted-foreground text-xs">
										<code>
											{form.watch("otel_config.protocol") === "http"
												? t("observabilityConnectors.otel.collectorUrlHttpHint")
												: t("observabilityConnectors.otel.collectorUrlGrpcHint")}
										</code>
									</div>
									<FormControl>
										<EnvVarInput
											placeholder={
												form.watch("otel_config.protocol") === "http"
													? t("observabilityConnectors.otel.collectorUrlHttpPlaceholder")
													: t("observabilityConnectors.otel.collectorUrlGrpcPlaceholder")
											}
											disabled={!hasOtelAccess}
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="otel_config.headers"
							render={({ field }) => (
								<FormItem className="w-full">
									<FormControl>
										<HeadersTable value={field.value || {}} onChange={field.onChange} disabled={!hasOtelAccess} useEnvVarInput />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<div className="flex flex-row gap-4">
							<FormField
								control={form.control}
								name="otel_config.trace_type"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("observabilityConnectors.otel.format")}</FormLabel>
										<Select onValueChange={field.onChange} value={field.value ?? traceTypeOptions[0].value} disabled={!hasOtelAccess}>
											<FormControl>
												<SelectTrigger className="w-full">
													<SelectValue placeholder={t("observabilityConnectors.otel.selectTraceType")} />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{traceTypeOptions.map((option) => (
													<SelectItem
														key={option.value}
														value={option.value}
														disabled={option.disabled}
														disabledReason={option.disabledReason}
													>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="otel_config.protocol"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("observabilityConnectors.otel.protocol")}</FormLabel>
										<Select onValueChange={field.onChange} value={field.value} disabled={!hasOtelAccess}>
											<FormControl>
												<SelectTrigger className="w-full">
													<SelectValue placeholder={t("observabilityConnectors.otel.selectProtocol")} />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												{protocolOptions.map((option) => (
													<SelectItem key={option.value} value={option.value}>
														{option.label}
													</SelectItem>
												))}
											</SelectContent>
										</Select>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>

						{/* TLS Configuration */}
						<div className="flex flex-col gap-4">
							<FormField
								control={form.control}
								name="otel_config.insecure"
								render={({ field }) => (
									<FormItem className="flex flex-row items-center gap-2">
										<div className="flex w-full flex-row items-center gap-2">
											<div className="flex flex-col gap-1">
												<FormLabel>{t("observabilityConnectors.otel.insecureTls")}</FormLabel>
												<FormDescription>{t("observabilityConnectors.otel.insecureTlsDesc")}</FormDescription>
											</div>
											<div className="ml-auto">
												<Switch
													checked={field.value}
													onCheckedChange={(checked) => {
														field.onChange(checked);
														if (checked) {
															form.setValue("otel_config.tls_ca_cert", "");
														}
													}}
													disabled={!hasOtelAccess}
												/>
											</div>
										</div>
									</FormItem>
								)}
							/>
							{!form.watch("otel_config.insecure") && (
								<FormField
									control={form.control}
									name="otel_config.tls_ca_cert"
									render={({ field }) => (
										<FormItem className="w-full">
											<FormLabel>{t("observabilityConnectors.otel.tlsCaCert")}</FormLabel>
											<FormDescription>{t("observabilityConnectors.otel.tlsCaCertDesc")}</FormDescription>
											<FormControl>
												<Input placeholder={t("observabilityConnectors.otel.tlsCaCertPlaceholder")} disabled={!hasOtelAccess} {...field} />
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
							)}
						</div>
					</div>
				</div>

				{/* Metrics Push Configuration */}
				<div className="space-y-4 border-t pt-4">
					<FormField
						control={form.control}
						name="otel_config.metrics_enabled"
						render={({ field }) => (
							<FormItem className="flex flex-row items-center gap-2">
								<div className="flex w-full flex-row items-center gap-2">
									<div className="flex flex-col gap-1">
										<h3 className="flex flex-row items-center gap-2 text-sm font-medium">
											{t("observabilityConnectors.otel.metricsExport")}{" "}
											<Badge variant="secondary">{t("observabilityConnectors.beta")}</Badge>
										</h3>
										<p className="text-muted-foreground text-xs">{t("observabilityConnectors.otel.metricsExportDesc")}</p>
									</div>
									<div className="ml-auto">
										<Switch
											data-testid="otel-metrics-export-toggle"
											checked={field.value}
											onCheckedChange={field.onChange}
											disabled={!hasOtelAccess}
										/>
									</div>
								</div>
							</FormItem>
						)}
					/>

					{form.watch("otel_config.metrics_enabled") && (
						<div className="border-muted flex flex-col gap-4">
							<FormField
								control={form.control}
								name="otel_config.metrics_endpoint"
								render={({ field }) => (
									<FormItem className="w-full">
										<FormLabel>{t("observabilityConnectors.otel.metricsEndpoint")}</FormLabel>
										<div className="text-muted-foreground text-xs">
											<code>
												{form.watch("otel_config.protocol") === "http"
													? t("observabilityConnectors.otel.metricsEndpointHttpHint")
													: t("observabilityConnectors.otel.collectorUrlGrpcHint")}
											</code>
										</div>
										<FormControl>
											<EnvVarInput
												placeholder={
													form.watch("otel_config.protocol") === "http"
														? t("observabilityConnectors.otel.metricsEndpointHttpPlaceholder")
														: t("observabilityConnectors.otel.metricsEndpointGrpcPlaceholder")
												}
												disabled={!hasOtelAccess}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							<FormField
								control={form.control}
								name="otel_config.metrics_push_interval"
								render={({ field }) => (
									<FormItem className="w-full max-w-xs">
										<FormLabel>{t("observabilityConnectors.otel.pushInterval")}</FormLabel>
										<FormControl>
											<Input
												type="number"
												min={1}
												max={300}
												disabled={!hasOtelAccess}
												{...field}
												value={field.value ?? ""}
												onChange={(e) => field.onChange(e.target.value === "" ? null : Number(e.target.value))}
											/>
										</FormControl>
										<FormDescription>{t("observabilityConnectors.otel.pushIntervalDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
					)}
				</div>

				{/* Form Actions */}
				<div className="flex w-full flex-row items-center">
					<FormField
						control={form.control}
						name="enabled"
						render={({ field }) => (
							<FormItem className="flex items-center gap-2 py-2">
								<FormLabel className="text-muted-foreground text-sm font-medium">{t("observabilityConnectors.enabled")}</FormLabel>
								<FormControl>
									<Switch
										checked={field.value}
										onCheckedChange={field.onChange}
										disabled={!hasOtelAccess}
										data-testid="otel-connector-enable-toggle"
									/>
								</FormControl>
							</FormItem>
						)}
					/>
					<div className="ml-auto flex justify-end space-x-2 py-2">
						{onDelete && (
							<Button
								type="button"
								variant="outline"
								onClick={onDelete}
								disabled={isDeleting || !hasOtelAccess}
								data-testid="otel-connector-delete-btn"
								title={t("observabilityConnectors.deleteConnector")}
								aria-label={t("observabilityConnectors.deleteConnectorAria")}
							>
								<Trash2 className="size-4" />
							</Button>
						)}
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								form.reset(buildDefaults(initialConfig));
							}}
							disabled={!hasOtelAccess || isLoading || !form.formState.isDirty}
						>
							{t("observabilityConnectors.reset")}
						</Button>
						<TooltipProvider>
							<Tooltip>
								<TooltipTrigger asChild>
									<Button type="submit" disabled={!hasOtelAccess || !form.formState.isDirty} isLoading={isSaving}>
										{t("observabilityConnectors.otel.save")}
									</Button>
								</TooltipTrigger>
								{!form.formState.isDirty && (
									<TooltipContent>
										<p>
											{!form.formState.isDirty && !form.formState.isValid
												? t("observabilityConnectors.noChangesWithErrors")
												: !form.formState.isDirty
													? t("observabilityConnectors.noChanges")
													: t("observabilityConnectors.fixValidation")}
										</p>
									</TooltipContent>
								)}
							</Tooltip>
						</TooltipProvider>
					</div>
				</div>
			</form>
		</Form>
	);
}
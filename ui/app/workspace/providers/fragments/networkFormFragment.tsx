import { Button } from "@/components/ui/button";
import { EnvVarInput } from "@/components/ui/envVarInput";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { HeadersTable } from "@/components/ui/headersTable";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { DefaultNetworkConfig } from "@/lib/constants/config";
import { useT, type TranslateFn } from "@/lib/i18n";
import { getErrorMessage, setProviderFormDirtyState, useAppDispatch } from "@/lib/store";
import { useUpdateProviderMutation } from "@/lib/store/apis/providersApi";
import { ModelProvider, isKnownProvider } from "@/lib/types/config";
import { networkOnlyFormSchema, type EnvVar, type NetworkOnlyFormSchema } from "@/lib/types/schemas";
import { toEnvVarFormValue, toOptionalEnvVarPayload } from "@/lib/utils/envVarForm";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm, type Resolver } from "react-hook-form";
import { toast } from "sonner";
import { buildProviderUpdatePayload } from "../views/utils";

interface NetworkFormFragmentProps {
	provider: ModelProvider;
}

// seconds to human readable time
const secondsToHumanReadable = (seconds: number, t: TranslateFn) => {
	// Handle edge cases
	if (!seconds || seconds < 0 || isNaN(seconds)) {
		return t("providers.network.duration.zeroSeconds");
	}
	seconds = Math.floor(seconds);
	if (seconds < 60) {
		return `${seconds} ${seconds === 1 ? t("providers.network.duration.second") : t("providers.network.duration.seconds")}`;
	}
	if (seconds < 3600) {
		const minutes = Math.floor(seconds / 60);
		return `${minutes} ${minutes === 1 ? t("providers.network.duration.minute") : t("providers.network.duration.minutes")}`;
	}
	if (seconds < 86400) {
		const hours = Math.floor(seconds / 3600);
		return `${hours} ${hours === 1 ? t("providers.network.duration.hour") : t("providers.network.duration.hours")}`;
	}
	// For >= 1 day, only show non-zero components
	const days = Math.floor(seconds / 86400);
	const hours = Math.floor((seconds % 86400) / 3600);
	const minutes = Math.floor((seconds % 3600) / 60);
	const remainingSeconds = seconds % 60;
	const parts: string[] = [];
	parts.push(`${days} ${days === 1 ? t("providers.network.duration.day") : t("providers.network.duration.days")}`);
	if (hours > 0) parts.push(`${hours} ${hours === 1 ? t("providers.network.duration.hour") : t("providers.network.duration.hours")}`);
	if (minutes > 0) parts.push(`${minutes} ${minutes === 1 ? t("providers.network.duration.minute") : t("providers.network.duration.minutes")}`);
	if (remainingSeconds > 0)
		parts.push(`${remainingSeconds} ${remainingSeconds === 1 ? t("providers.network.duration.second") : t("providers.network.duration.seconds")}`);
	return parts.join(" ");
};

export function NetworkFormFragment({ provider }: NetworkFormFragmentProps) {
	const t = useT();
	const dispatch = useAppDispatch();
	const hasUpdateProviderAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const [updateProvider, { isLoading: isUpdatingProvider }] = useUpdateProviderMutation();
	const isCustomProvider = !isKnownProvider(provider.name as string);

	const form = useForm<NetworkOnlyFormSchema, any, NetworkOnlyFormSchema>({
		resolver: zodResolver(networkOnlyFormSchema) as Resolver<NetworkOnlyFormSchema, any, NetworkOnlyFormSchema>,
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			network_config: {
				base_url: provider.network_config?.base_url || undefined,
				extra_headers: provider.network_config?.extra_headers,
				default_request_timeout_in_seconds:
					provider.network_config?.default_request_timeout_in_seconds ?? DefaultNetworkConfig.default_request_timeout_in_seconds,
				max_retries: provider.network_config?.max_retries ?? DefaultNetworkConfig.max_retries,
				retry_backoff_initial: provider.network_config?.retry_backoff_initial ?? DefaultNetworkConfig.retry_backoff_initial,
				retry_backoff_max: provider.network_config?.retry_backoff_max ?? DefaultNetworkConfig.retry_backoff_max,
				insecure_skip_verify: provider.network_config?.insecure_skip_verify ?? DefaultNetworkConfig.insecure_skip_verify,
				ca_cert_pem: toEnvVarFormValue(provider.network_config?.ca_cert_pem as EnvVar | string | undefined),
				stream_idle_timeout_in_seconds:
					provider.network_config?.stream_idle_timeout_in_seconds ?? DefaultNetworkConfig.stream_idle_timeout_in_seconds,
				max_conns_per_host: provider.network_config?.max_conns_per_host ?? DefaultNetworkConfig.max_conns_per_host,
				enforce_http2: provider.network_config?.enforce_http2 ?? DefaultNetworkConfig.enforce_http2,
			},
		},
	});

	useEffect(() => {
		dispatch(setProviderFormDirtyState(form.formState.isDirty));
	}, [form.formState.isDirty, dispatch]);

	const onSubmit = (data: NetworkOnlyFormSchema) => {
		const requiresBaseUrl = isCustomProvider;
		if (requiresBaseUrl && (data.network_config?.base_url ?? "").trim() === "") {
			if ((provider.network_config?.base_url ?? "").trim() !== "") {
				toast.error(t("providers.network.cannotRemove"));
			} else {
				toast.error(t("providers.network.baseUrlRequired"));
			}
			return;
		}
		// Create updated provider configuration
		const updatedProvider = buildProviderUpdatePayload(provider, {
			network_config: {
				...provider.network_config,
				base_url: data.network_config?.base_url || undefined,
				extra_headers: data.network_config?.extra_headers || undefined,
				default_request_timeout_in_seconds: data.network_config?.default_request_timeout_in_seconds ?? 30,
				max_retries: data.network_config?.max_retries ?? 0,
				retry_backoff_initial: data.network_config?.retry_backoff_initial ?? 500,
				retry_backoff_max: data.network_config?.retry_backoff_max ?? 10000,
				insecure_skip_verify: data.network_config?.insecure_skip_verify ?? false,
				ca_cert_pem: toOptionalEnvVarPayload(data.network_config?.ca_cert_pem),
				stream_idle_timeout_in_seconds:
					data.network_config?.stream_idle_timeout_in_seconds ?? DefaultNetworkConfig.stream_idle_timeout_in_seconds,
				max_conns_per_host: data.network_config?.max_conns_per_host ?? DefaultNetworkConfig.max_conns_per_host,
				enforce_http2: data.network_config?.enforce_http2 ?? DefaultNetworkConfig.enforce_http2,
			},
		});
		updateProvider(updatedProvider)
			.unwrap()
			.then(() => {
				toast.success(t("providers.toast.configUpdated"));
				form.reset(data);
			})
			.catch((err) => {
				toast.error(t("providers.toast.configUpdateFailed"), {
					description: getErrorMessage(err),
				});
			});
	};

	useEffect(() => {
		// Reset form with new provider's network_config when provider.name changes
		form.reset({
			network_config: {
				base_url: provider.network_config?.base_url || undefined,
				extra_headers: provider.network_config?.extra_headers,
				default_request_timeout_in_seconds:
					provider.network_config?.default_request_timeout_in_seconds ?? DefaultNetworkConfig.default_request_timeout_in_seconds,
				max_retries: provider.network_config?.max_retries ?? DefaultNetworkConfig.max_retries,
				retry_backoff_initial: provider.network_config?.retry_backoff_initial ?? DefaultNetworkConfig.retry_backoff_initial,
				retry_backoff_max: provider.network_config?.retry_backoff_max ?? DefaultNetworkConfig.retry_backoff_max,
				insecure_skip_verify: provider.network_config?.insecure_skip_verify ?? DefaultNetworkConfig.insecure_skip_verify,
				ca_cert_pem: toEnvVarFormValue(provider.network_config?.ca_cert_pem as EnvVar | string | undefined),
				stream_idle_timeout_in_seconds:
					provider.network_config?.stream_idle_timeout_in_seconds ?? DefaultNetworkConfig.stream_idle_timeout_in_seconds,
				max_conns_per_host: provider.network_config?.max_conns_per_host ?? DefaultNetworkConfig.max_conns_per_host,
				enforce_http2: provider.network_config?.enforce_http2 ?? DefaultNetworkConfig.enforce_http2,
			},
		});
	}, [form, provider.name, provider.network_config]);

	const baseURLRequired = isCustomProvider;
	const hideBaseURL = provider.name === "vllm" || provider.name === "ollama" || provider.name === "sgl";

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)}>
				{/* Network Configuration */}
				<div className="space-y-4 px-6 pb-6">
					<div className="grid grid-cols-1 gap-4">
						{!hideBaseURL && (
							<FormField
								control={form.control}
								name="network_config.base_url"
								render={({ field }) => (
									<FormItem>
										<FormLabel>
											{t("providers.network.baseUrl")} {baseURLRequired ? t("providers.network.required") : t("providers.network.optional")}
										</FormLabel>
										<FormControl>
											<Input
												placeholder={isCustomProvider ? t("providers.network.baseUrlPlaceholderCustom") : t("providers.network.baseUrlPlaceholder")}
												{...field}
												value={field.value || ""}
												disabled={!hasUpdateProviderAccess}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						)}
						<div className="flex w-full flex-row items-start gap-4">
							<FormField
								control={form.control}
								name="network_config.default_request_timeout_in_seconds"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("providers.network.timeoutSeconds")}</FormLabel>
										<FormControl>
											<Input
												placeholder="30"
												{...field}
												value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
												disabled={!hasUpdateProviderAccess}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														field.onChange(undefined);
														return;
													}
													const parsed = Number(value);
													if (!Number.isNaN(parsed)) {
														field.onChange(parsed);
													}
													form.trigger("network_config");
												}}
											/>
										</FormControl>
										<FormDescription>{secondsToHumanReadable(field.value, t)}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="network_config.stream_idle_timeout_in_seconds"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("providers.network.streamIdleTimeout")}</FormLabel>
										<FormControl>
											<Input
												placeholder="60"
												data-testid="network-config-stream-idle-timeout-input"
												{...field}
												value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
												disabled={!hasUpdateProviderAccess}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														field.onChange(undefined);
														return;
													}
													const parsed = Number(value);
													if (!Number.isNaN(parsed)) {
														field.onChange(parsed);
													}
													form.trigger("network_config");
												}}
											/>
										</FormControl>
										<FormDescription>
											{field.value ? secondsToHumanReadable(field.value, t) : ""} {t("providers.network.streamIdleTimeoutHint")}
										</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="network_config.max_retries"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("providers.network.maxRetries")}</FormLabel>
										<FormControl>
											<Input
												placeholder="0"
												{...field}
												value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
												disabled={!hasUpdateProviderAccess}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														field.onChange(undefined);
														return;
													}
													const parsed = Number(value);
													if (!Number.isNaN(parsed)) {
														field.onChange(parsed);
													}
													form.trigger("network_config");
												}}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<div className="flex w-full flex-row items-start gap-4">
							<FormField
								control={form.control}
								name="network_config.retry_backoff_initial"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("providers.network.initialBackoffMs")}</FormLabel>
										<FormControl>
											<Input
												placeholder="e.g 500"
												{...field}
												value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
												disabled={!hasUpdateProviderAccess}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														field.onChange(undefined);
														return;
													}
													const parsed = Number(value);
													if (!Number.isNaN(parsed)) {
														field.onChange(parsed);
													}
													form.trigger("network_config");
												}}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="network_config.retry_backoff_max"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("providers.network.maxBackoffMs")}</FormLabel>
										<FormControl>
											<Input
												placeholder="e.g 10000"
												{...field}
												value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
												disabled={!hasUpdateProviderAccess}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														field.onChange(undefined);
														return;
													}
													const parsed = Number(value);
													if (!Number.isNaN(parsed)) {
														field.onChange(parsed);
													}
													form.trigger("network_config");
												}}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<div className="flex w-full flex-row items-start gap-4">
							<FormField
								control={form.control}
								name="network_config.max_conns_per_host"
								render={({ field }) => (
									<FormItem className="flex-1">
										<FormLabel>{t("providers.network.maxConnsPerHost")}</FormLabel>
										<FormControl>
											<Input
												data-testid="network-config-max-conns-per-host-input"
												placeholder="5000"
												{...field}
												value={field.value === undefined || Number.isNaN(field.value) ? "" : field.value}
												disabled={!hasUpdateProviderAccess}
												onChange={(e) => {
													const value = e.target.value;
													if (value === "") {
														field.onChange(undefined);
														return;
													}
													const parsed = Number(value);
													if (!Number.isNaN(parsed)) {
														field.onChange(parsed);
													}
													form.trigger("network_config");
												}}
											/>
										</FormControl>
										<FormDescription>{t("providers.network.maxConnsPerHostDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
						<FormField
							control={form.control}
							name="network_config.enforce_http2"
							render={({ field }) => (
								<FormItem className="flex flex-row items-center justify-between">
									<div className="space-y-0.5">
										<FormLabel>{t("providers.network.enforceHttp2")}</FormLabel>
										<FormDescription>{t("providers.network.enforceHttp2Desc")}</FormDescription>
									</div>
									<FormControl>
										<Switch
											checked={field.value ?? false}
											onCheckedChange={field.onChange}
											disabled={!hasUpdateProviderAccess}
											data-testid="network-config-enforce-http2"
										/>
									</FormControl>
								</FormItem>
							)}
						/>
						<FormField
							control={form.control}
							name="network_config.extra_headers"
							render={({ field }) => (
								<FormItem>
									<FormControl>
										<HeadersTable
											value={field.value || {}}
											onChange={field.onChange}
											keyPlaceholder={t("providers.network.headerName")}
											valuePlaceholder={t("providers.network.headerValue")}
											label={t("providers.network.extraHeaders")}
											disabled={!hasUpdateProviderAccess}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
						<div className="space-y-4 rounded-lg border p-4">
							<h4 className="text-sm font-medium">{t("providers.network.tlsCertificate")}</h4>
							<FormField
								control={form.control}
								name="network_config.insecure_skip_verify"
								render={({ field }) => (
									<FormItem className="flex flex-row items-center justify-between rounded-lg border p-4">
										<div className="space-y-0.5">
											<FormLabel>{t("providers.network.skipTlsVerification")}</FormLabel>
											<FormDescription>{t("providers.network.skipTlsDesc")}</FormDescription>
										</div>
										<FormControl>
											<Switch
												checked={field.value ?? false}
												onCheckedChange={field.onChange}
												disabled={!hasUpdateProviderAccess}
												data-testid="network-config-insecure-skip-verify"
											/>
										</FormControl>
									</FormItem>
								)}
							/>
							<FormField
								control={form.control}
								name="network_config.ca_cert_pem"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providers.network.caCertPem")}</FormLabel>
										<FormControl>
											<EnvVarInput
												variant="textarea"
												placeholder={t("providers.network.caCertPlaceholder")}
												className="font-mono text-xs"
												rows={6}
												hideValueWhenEnv
												redactNonEnvValue
												{...field}
												value={field.value}
												disabled={!hasUpdateProviderAccess}
												data-testid="network-config-ca-cert-pem"
											/>
										</FormControl>
										<FormDescription>{t("providers.network.caCertDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>
						</div>
					</div>
				</div>

				{/* Form Actions */}
				<div className="bg-card sticky bottom-0 flex justify-end space-x-2 rounded-b-sm border-t px-6 py-4">
					{!hideBaseURL && (
						<Button
							type="button"
							variant="outline"
							onClick={() => {
								form.reset({
									network_config: undefined,
								});
								onSubmit(form.getValues());
							}}
							disabled={
								!hasUpdateProviderAccess ||
								isUpdatingProvider ||
								!provider.network_config ||
								!provider.network_config.base_url ||
								provider.network_config.base_url.trim() === ""
							}
						>
							{t("providers.fragments.removeConfiguration")}
						</Button>
					)}
					<TooltipProvider>
						<Tooltip>
							<TooltipTrigger asChild>
								<Button type="submit" disabled={!form.formState.isDirty || !hasUpdateProviderAccess} isLoading={isUpdatingProvider}>
									{t("providers.network.save")}
								</Button>
							</TooltipTrigger>
							{(!form.formState.isDirty || !form.formState.isValid) && (
								<TooltipContent>
									<p>
										{!form.formState.isDirty && !form.formState.isValid
											? t("providers.network.noChangesWithErrors")
											: !form.formState.isDirty
												? t("providers.network.noChanges")
												: t("providers.network.fixErrors")}
									</p>
								</TooltipContent>
							)}
						</Tooltip>
					</TooltipProvider>
				</div>
			</form>
		</Form>
	);
}
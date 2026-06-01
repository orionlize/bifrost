import { Button } from "@/components/ui/button";
import { EnvVarInput } from "@/components/ui/envVarInput";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import { getErrorMessage, setProviderFormDirtyState, useAppDispatch } from "@/lib/store";
import { useUpdateProviderMutation } from "@/lib/store/apis/providersApi";
import { ModelProvider } from "@/lib/types/config";
import { proxyOnlyFormSchema, type EnvVar, type ProxyOnlyFormSchema } from "@/lib/types/schemas";
import { cn } from "@/lib/utils";
import { toEnvVarFormValue, toOptionalEnvVarPayload } from "@/lib/utils/envVarForm";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { buildProviderUpdatePayload } from "../views/utils";

interface ProxyFormFragmentProps {
	provider: ModelProvider;
}

export function ProxyFormFragment({ provider }: ProxyFormFragmentProps) {
	const t = useT();
	const dispatch = useAppDispatch();
	const hasUpdateProviderAccess = useRbac(RbacResource.ModelProvider, RbacOperation.Update);
	const [updateProvider, { isLoading: isUpdatingProvider }] = useUpdateProviderMutation();
	const form = useForm<ProxyOnlyFormSchema>({
		resolver: zodResolver(proxyOnlyFormSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: {
			proxy_config: {
				type: provider.proxy_config?.type,
				url: toEnvVarFormValue(provider.proxy_config?.url as EnvVar | string | undefined),
				username: toEnvVarFormValue(provider.proxy_config?.username as EnvVar | string | undefined),
				password: toEnvVarFormValue(provider.proxy_config?.password as EnvVar | string | undefined),
				ca_cert_pem: toEnvVarFormValue(provider.proxy_config?.ca_cert_pem as EnvVar | string | undefined),
			},
		},
	});

	useEffect(() => {
		dispatch(setProviderFormDirtyState(form.formState.isDirty));
	}, [form.formState.isDirty, dispatch]);

	useEffect(() => {
		form.reset({
			proxy_config: {
				type: provider.proxy_config?.type,
				url: toEnvVarFormValue(provider.proxy_config?.url as EnvVar | string | undefined),
				username: toEnvVarFormValue(provider.proxy_config?.username as EnvVar | string | undefined),
				password: toEnvVarFormValue(provider.proxy_config?.password as EnvVar | string | undefined),
				ca_cert_pem: toEnvVarFormValue(provider.proxy_config?.ca_cert_pem as EnvVar | string | undefined),
			},
		});
	}, [form, provider.name, provider.proxy_config]);

	const watchedProxyType = form.watch("proxy_config.type");

	const onSubmit = (data: ProxyOnlyFormSchema) => {
		updateProvider(
			buildProviderUpdatePayload(provider, {
				proxy_config: {
					type: data.proxy_config?.type ?? "none",
					url: toOptionalEnvVarPayload(data.proxy_config?.url),
					username: toOptionalEnvVarPayload(data.proxy_config?.username),
					password: toOptionalEnvVarPayload(data.proxy_config?.password),
					ca_cert_pem: toOptionalEnvVarPayload(data.proxy_config?.ca_cert_pem),
				},
			}),
		)
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

	return (
		<Form {...form}>
			<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6 px-6">
				{/* Proxy Configuration */}
				<div className="space-y-4">
					<div className="space-y-4">
						<FormField
							control={form.control}
							name="proxy_config.type"
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("providers.proxy.proxyType")}</FormLabel>
									<Select
										onValueChange={field.onChange}
										value={field.value === "none" ? "" : field.value}
										disabled={!hasUpdateProviderAccess}
									>
										<FormControl>
											<SelectTrigger className="w-48">
												<SelectValue placeholder={t("providers.proxy.selectType")} />
											</SelectTrigger>
										</FormControl>
										<SelectContent>
											<SelectItem value="http">{t("providers.proxy.typeHttp")}</SelectItem>
											<SelectItem value="socks5">{t("providers.proxy.typeSocks5")}</SelectItem>
											<SelectItem value="environment">{t("providers.proxy.typeEnvironment")}</SelectItem>
										</SelectContent>
									</Select>
									<FormMessage />
								</FormItem>
							)}
						/>

						<div
							className={cn(
								"block transition-all duration-200",
								(!watchedProxyType || watchedProxyType === "none" || watchedProxyType === "environment") && "hidden",
							)}
						>
							<div className="space-y-4 pt-2">
								<FormField
									control={form.control}
									name="proxy_config.url"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("providers.proxy.proxyUrl")}</FormLabel>
											<FormControl>
												<EnvVarInput
													placeholder={t("providers.proxy.proxyUrlPlaceholder")}
													{...field}
													value={field.value}
													disabled={!hasUpdateProviderAccess}
													data-testid="env-var-proxy-url"
												/>
											</FormControl>
											<FormMessage />
										</FormItem>
									)}
								/>
								<div className="grid grid-cols-2 gap-4">
									<FormField
										control={form.control}
										name="proxy_config.username"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("providers.proxy.username")}</FormLabel>
												<FormControl>
													<EnvVarInput
														placeholder={t("providers.proxy.usernamePlaceholder")}
														{...field}
														value={field.value}
														disabled={!hasUpdateProviderAccess}
														data-testid="env-var-proxy-username"
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="proxy_config.password"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("providers.proxy.password")}</FormLabel>
												<FormControl>
													<EnvVarInput
														type="password"
														placeholder={t("providers.proxy.passwordPlaceholder")}
														hideValueWhenEnv
														redactNonEnvValue
														{...field}
														value={field.value}
														disabled={!hasUpdateProviderAccess}
														data-testid="env-var-proxy-password"
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
								<FormField
									control={form.control}
									name="proxy_config.ca_cert_pem"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("providers.proxy.caCertPem")}</FormLabel>
											<FormControl>
												<EnvVarInput
													variant="textarea"
													placeholder={t("providers.proxy.caCertPlaceholder")}
													className="font-mono text-xs"
													rows={6}
													hideValueWhenEnv
													redactNonEnvValue
													{...field}
													value={field.value}
													disabled={!hasUpdateProviderAccess}
													data-testid="env-var-proxy-ca-cert-pem"
												/>
											</FormControl>
											<FormDescription>
												{t("providers.proxy.caCertDesc")} <code>{t("providers.proxy.caCertDescEnvSuffix")}</code>.
											</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>
							</div>
						</div>
					</div>
				</div>

				{/* Form Actions */}
				<div className="mb-6 flex justify-end space-x-2">
					<Button
						type="button"
						variant="outline"
						onClick={() => {
							onSubmit({ proxy_config: { type: "none" } });
						}}
						disabled={!hasUpdateProviderAccess || isUpdatingProvider || !provider.proxy_config || provider.proxy_config.type === "none"}
					>
						{t("providers.fragments.removeConfiguration")}
					</Button>
					<Button
						type="submit"
						disabled={!form.formState.isDirty || !hasUpdateProviderAccess || isUpdatingProvider}
						isLoading={isUpdatingProvider}
					>
						{t("providers.proxy.save")}
					</Button>
				</div>
			</form>
		</Form>
	);
}
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { IS_ENTERPRISE } from "@/lib/constants/config";
import { getErrorMessage, useGetCoreConfigQuery, useUpdateProxyConfigMutation } from "@/lib/store";
import { DefaultGlobalProxyConfig, GlobalProxyConfig } from "@/lib/types/config";
import { globalProxyConfigSchema } from "@/lib/types/schemas";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { useNavDescription, useNavTitle } from "@/lib/i18n/useNavTitle";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { zodResolver } from "@hookform/resolvers/zod";
import { AlertTriangle, Info } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

export default function ProxyView() {
	const t = useT();
	const pageTitle = useNavTitle("proxy");
	const pageDescription = useNavDescription("proxy");
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });
	const proxyConfig = bifrostConfig?.proxy_config;
	const [updateProxyConfig, { isLoading }] = useUpdateProxyConfigMutation();

	const form = useForm<GlobalProxyConfig>({
		resolver: zodResolver(globalProxyConfigSchema),
		mode: "onChange",
		reValidateMode: "onChange",
		defaultValues: DefaultGlobalProxyConfig,
	});

	useEffect(() => {
		if (proxyConfig) {
			form.reset({
				...DefaultGlobalProxyConfig,
				...proxyConfig,
			});
		}
	}, [proxyConfig, form]);

	const watchedEnabled = form.watch("enabled");
	const watchedType = form.watch("type");

	const onSubmit = async (data: GlobalProxyConfig) => {
		try {
			await updateProxyConfig(data).unwrap();
			toast.success(t("configViews.proxy.updated"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	const isTypeUnsupported = watchedType === "socks5" || watchedType === "tcp";

	return (
		<div className="mx-auto w-full max-w-4xl space-y-4">
			<Form {...form}>
				<form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
					<div>
						<h2 className="text-lg font-semibold tracking-tight">{pageTitle}</h2>
						<p className="text-muted-foreground text-sm">{pageDescription}</p>
					</div>

					<fieldset disabled={!hasSettingsUpdateAccess} className="space-y-4">
						<div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
							<div className="space-y-0.5">
								<FormLabel className="text-sm font-medium">{t("configViews.proxy.enableProxy")}</FormLabel>
								<p className="text-muted-foreground text-sm">{t("configViews.proxy.enableProxyDesc")}</p>
							</div>
							<FormField
								control={form.control}
								name="enabled"
								render={({ field }) => (
									<FormItem>
										<FormControl>
											<Switch checked={field.value} onCheckedChange={field.onChange} />
										</FormControl>
									</FormItem>
								)}
							/>
						</div>

						<div className={cn("space-y-4 rounded-lg border p-4 transition-opacity", !watchedEnabled && "pointer-events-none opacity-50")}>
							<h3 className="text-lg font-medium">{t("configViews.proxy.proxyConfiguration")}</h3>

							<FormField
								control={form.control}
								name="type"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("configViews.proxy.proxyType")}</FormLabel>
										<Select onValueChange={field.onChange} value={field.value} disabled={!watchedEnabled}>
											<FormControl>
												<SelectTrigger className="w-48">
													<SelectValue placeholder={t("configViews.proxy.selectType")} />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="http">{t("configViews.proxy.typeHttp")}</SelectItem>
												<SelectItem value="socks5" disabled>
													{t("configViews.proxy.typeSocks5")}{" "}
													<Badge variant="outline" className="ml-2 text-xs">
														{t("configViews.shared.comingSoon")}
													</Badge>
												</SelectItem>
												<SelectItem value="tcp" disabled>
													{t("configViews.proxy.typeTcp")}{" "}
													<Badge variant="outline" className="ml-2 text-xs">
														{t("configViews.shared.comingSoon")}
													</Badge>
												</SelectItem>
											</SelectContent>
										</Select>
										<FormDescription>{t("configViews.proxy.proxyTypeDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							{isTypeUnsupported && watchedEnabled && (
								<Alert variant="destructive">
									<AlertTriangle className="h-4 w-4" />
									<AlertDescription>
										{t("configViews.proxy.typeUnsupported", { type: watchedType.toUpperCase() })}
									</AlertDescription>
								</Alert>
							)}

							<FormField
								control={form.control}
								name="url"
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("configViews.proxy.proxyUrl")}</FormLabel>
										<FormControl>
											<Input placeholder={t("configViews.proxy.proxyUrlPlaceholder")} disabled={!watchedEnabled} {...field} />
										</FormControl>
										<FormDescription>{t("configViews.proxy.proxyUrlDesc")}</FormDescription>
										<FormMessage />
									</FormItem>
								)}
							/>

							<div className="bg-muted/20 space-y-4 rounded-md border p-4">
								<h4 className="text-sm font-medium">{t("configViews.proxy.authOptional")}</h4>
								<div className="grid grid-cols-2 gap-4">
									<FormField
										control={form.control}
										name="username"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("configViews.proxy.username")}</FormLabel>
												<FormControl>
													<Input placeholder={t("configViews.proxy.usernamePlaceholder")} disabled={!watchedEnabled} {...field} value={field.value || ""} />
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
									<FormField
										control={form.control}
										name="password"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("configViews.proxy.password")}</FormLabel>
												<FormControl>
													<Input
														type="password"
														placeholder={t("configViews.proxy.passwordPlaceholder")}
														disabled={!watchedEnabled}
														{...field}
														value={field.value || ""}
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>
								</div>
							</div>

							<div className="bg-muted/20 space-y-4 rounded-md border p-4">
								<h4 className="text-sm font-medium">{t("configViews.proxy.advancedSettings")}</h4>

								<FormField
									control={form.control}
									name="no_proxy"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("configViews.proxy.noProxyHosts")}</FormLabel>
											<FormControl>
												<Textarea
													placeholder={t("configViews.proxy.noProxyHostsPlaceholder")}
													className="h-20"
													disabled={!watchedEnabled}
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormDescription>{t("configViews.proxy.noProxyHostsDesc")}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="timeout"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("configViews.proxy.connectionTimeout")}</FormLabel>
											<FormControl>
												<Input
													type="number"
													min={0}
													max={300}
													placeholder="30"
													className="w-32"
													disabled={!watchedEnabled}
													{...field}
													value={field.value ?? ""}
													onChange={(e) => field.onChange(e.target.value !== "" ? parseInt(e.target.value, 10) : undefined)}
												/>
											</FormControl>
											<FormDescription>{t("configViews.proxy.connectionTimeoutDesc")}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<FormField
									control={form.control}
									name="ca_cert_pem"
									render={({ field }) => (
										<FormItem>
											<FormLabel>{t("configViews.proxy.caCertPem")}</FormLabel>
											<FormControl>
												<Textarea
													placeholder={t("configViews.proxy.caCertPlaceholder")}
													className="font-mono text-xs"
													rows={6}
													disabled={!watchedEnabled}
													{...field}
													value={field.value || ""}
												/>
											</FormControl>
											<FormDescription>{t("configViews.proxy.caCertDesc")}</FormDescription>
											<FormMessage />
										</FormItem>
									)}
								/>

								<div className="flex items-center justify-between">
									<div className="space-y-0.5">
										<FormLabel className="text-sm font-medium">{t("configViews.proxy.skipTlsVerification")}</FormLabel>
										<p className="text-muted-foreground text-sm">{t("configViews.proxy.skipTlsVerificationDesc")}</p>
									</div>
									<FormField
										control={form.control}
										name="skip_tls_verify"
										render={({ field }) => (
											<FormItem>
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} disabled={!watchedEnabled} />
												</FormControl>
											</FormItem>
										)}
									/>
								</div>
							</div>
						</div>

						<div className={cn("space-y-4 rounded-lg border p-4 transition-opacity", !watchedEnabled && "pointer-events-none opacity-50")}>
							<div className="space-y-1">
								<h3 className="text-lg font-medium">{t("configViews.proxy.enableProxyFor")}</h3>
								<p className="text-muted-foreground text-sm">{t("configViews.proxy.enableProxyForDesc")}</p>
							</div>

							{IS_ENTERPRISE && (
								<div className="flex items-center justify-between rounded-md border p-4">
									<div className="space-y-0.5">
										<div className="flex items-center gap-2">
											<FormLabel className="text-sm font-medium">{t("configViews.proxy.scim")}</FormLabel>
											<Badge variant="secondary">{t("configViews.shared.enterprise")}</Badge>
										</div>
										<p className="text-muted-foreground text-sm">{t("configViews.proxy.scimDesc")}</p>
									</div>
									<FormField
										control={form.control}
										name="enable_for_scim"
										render={({ field }) => (
											<FormItem>
												<FormControl>
													<Switch checked={field.value} onCheckedChange={field.onChange} disabled={!watchedEnabled} />
												</FormControl>
											</FormItem>
										)}
									/>
								</div>
							)}

							<div className="flex items-center justify-between rounded-md border p-4 opacity-60">
								<div className="space-y-0.5">
									<div className="flex items-center gap-2">
										<FormLabel className="text-sm font-medium">{t("configViews.proxy.inference")}</FormLabel>
										<Badge variant="outline">{t("configViews.shared.comingSoon")}</Badge>
									</div>
									<p className="text-muted-foreground text-sm">{t("configViews.proxy.inferenceDesc")}</p>
								</div>
								<Switch disabled checked={false} />
							</div>

							<div className="flex items-center justify-between rounded-md border p-4 opacity-60">
								<div className="space-y-0.5">
									<div className="flex items-center gap-2">
										<FormLabel className="text-sm font-medium">{t("configViews.proxy.api")}</FormLabel>
										<Badge variant="outline">{t("configViews.shared.comingSoon")}</Badge>
									</div>
									<p className="text-muted-foreground text-sm">{t("configViews.proxy.apiDesc")}</p>
								</div>
								<Switch disabled checked={false} />
							</div>

							{!IS_ENTERPRISE && (
								<Alert>
									<Info className="h-4 w-4" />
									<AlertDescription>{t("configViews.proxy.scimEnterpriseAlert")}</AlertDescription>
								</Alert>
							)}
						</div>
					</fieldset>
					<div className="flex justify-end pt-2">
						<Tooltip>
							<TooltipTrigger asChild>
								<span tabIndex={!hasSettingsUpdateAccess ? 0 : undefined}>
									<Button
										type="submit"
										disabled={!form.formState.isDirty || !form.formState.isValid || isLoading || !hasSettingsUpdateAccess}
									>
										{isLoading ? t("common.actions.saving") : t("common.actions.saveChanges")}
									</Button>
								</span>
							</TooltipTrigger>
							{!hasSettingsUpdateAccess && <TooltipContent>{t("configViews.shared.noPermissionToUpdate")}</TooltipContent>}
						</Tooltip>
					</div>
				</form>
			</Form>
		</div>
	);
}

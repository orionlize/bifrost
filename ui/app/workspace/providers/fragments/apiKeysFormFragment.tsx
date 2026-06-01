import { EnvVarInput } from "@/components/ui/envVarInput";
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { HeadersTable, type CellRenderParams } from "@/components/ui/headersTable";
import { Input } from "@/components/ui/input";
import { ModelMultiselect } from "@/components/ui/modelMultiselect";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { TagInput } from "@/components/ui/tagInput";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { isRedacted } from "@/lib/utils/validation";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { Control, UseFormReturn } from "react-hook-form";

// Providers that support batch APIs
const BATCH_SUPPORTED_PROVIDERS = ["openai", "bedrock", "anthropic", "gemini", "azure"];

/** Normalize form value (object or legacy JSON string) for the alias map editor. */
function normalizeAliasesValue(v: Record<string, string> | string | undefined | null): Record<string, string> {
	if (v == null) {
		return {};
	}
	if (typeof v === "string") {
		const t = v.trim();
		if (!t) {
			return {};
		}
		try {
			const p = JSON.parse(t) as unknown;
			if (typeof p === "object" && p !== null && !Array.isArray(p)) {
				return Object.fromEntries(Object.entries(p as Record<string, unknown>).map(([k, val]) => [k, String(val ?? "")]));
			}
		} catch {
			return {};
		}
		return {};
	}
	if (typeof v === "object" && !Array.isArray(v)) {
		return Object.fromEntries(Object.entries(v).map(([k, val]) => [k, typeof val === "string" ? val : String(val ?? "")]));
	}
	return {};
}

interface Props {
	control: Control<any>;
	providerName: string;
	form: UseFormReturn<any>;
}

// Batch API form field for all providers
function BatchAPIFormField({ control }: { control: Control<any>; form: UseFormReturn<any> }) {
	const t = useT();
	return (
		<FormField
			control={control}
			name={`key.use_for_batch_api`}
			render={({ field }) => (
				<FormItem className="flex flex-row items-center justify-between rounded-sm border p-2">
					<div className="space-y-1.5">
						<FormLabel>{t("providersKeyForm.batchApi.label")}</FormLabel>
						<FormDescription>{t("providersKeyForm.batchApi.description")}</FormDescription>
					</div>
					<FormControl>
						<Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
					</FormControl>
				</FormItem>
			)}
		/>
	);
}

export function ApiKeyFormFragment({ control, providerName, form }: Props) {
	const t = useT();
	const isBedrock = providerName === "bedrock";
	const isVertex = providerName === "vertex";
	const isAzure = providerName === "azure";
	const isReplicate = providerName === "replicate";
	const isVLLM = providerName === "vllm";
	const isOllama = providerName === "ollama";
	const isSGL = providerName === "sgl";
	const isKeylessProvider = isOllama || isSGL;
	const supportsBatchAPI = BATCH_SUPPORTED_PROVIDERS.includes(providerName);

	// Auth type state for Azure: 'api_key', 'entra_id', or 'default_credential'
	const [azureAuthType, setAzureAuthType] = useState<"api_key" | "entra_id" | "default_credential">("api_key");

	// Auth type state for Bedrock: 'iam_role', 'explicit', or 'api_key'
	const [bedrockAuthType, setBedrockAuthType] = useState<"iam_role" | "explicit" | "api_key">("iam_role");

	// Auth type state for Vertex: 'service_account', 'service_account_json', or 'api_key'
	const [vertexAuthType, setVertexAuthType] = useState<"service_account" | "service_account_json" | "api_key">("service_account");

	// Detect auth type from existing form values when editing
	useEffect(() => {
		if (form.formState.isDirty) return;
		if (isAzure) {
			const clientId = form.getValues("key.azure_key_config.client_id");
			const clientSecret = form.getValues("key.azure_key_config.client_secret");
			const tenantId = form.getValues("key.azure_key_config.tenant_id");
			const apiKey = form.getValues("key.value");
			const hasEntraField =
				clientId?.value || clientId?.env_var || clientSecret?.value || clientSecret?.env_var || tenantId?.value || tenantId?.env_var;
			const hasApiKey = apiKey?.value || apiKey?.env_var;
			let detected: "api_key" | "entra_id" | "default_credential" = "api_key";
			if (hasEntraField) {
				detected = "entra_id";
			} else if (!hasApiKey) {
				detected = "default_credential";
			}
			setAzureAuthType(detected);
			form.setValue("key.azure_key_config._auth_type", detected);
		}
	}, [isAzure, form]);

	useEffect(() => {
		if (form.formState.isDirty) return;
		if (isVertex) {
			const authCredentials = form.getValues("key.vertex_key_config.auth_credentials")?.value;
			const authCredentialsEnv = form.getValues("key.vertex_key_config.auth_credentials")?.env_var;
			const apiKey = form.getValues("key.value")?.value;
			const apiKeyEnv = form.getValues("key.value")?.env_var;
			let detected: "service_account" | "service_account_json" | "api_key" = "service_account";
			if (authCredentials || authCredentialsEnv) {
				detected = "service_account_json";
			} else if (apiKey || apiKeyEnv) {
				detected = "api_key";
			}
			setVertexAuthType(detected);
			form.setValue("key.vertex_key_config._auth_type", detected);
		}
	}, [isVertex, form]);

	useEffect(() => {
		if (form.formState.isDirty) return;
		if (isBedrock) {
			const accessKey = form.getValues("key.bedrock_key_config.access_key");
			const secretKey = form.getValues("key.bedrock_key_config.secret_key");
			const apiKey = form.getValues("key.value");
			const hasExplicitCreds = accessKey?.value || accessKey?.env_var || secretKey?.value || secretKey?.env_var;
			const hasApiKey = apiKey?.value || apiKey?.env_var;
			let detected: "iam_role" | "explicit" | "api_key" = "iam_role";
			if (hasExplicitCreds) {
				detected = "explicit";
			} else if (hasApiKey) {
				detected = "api_key";
			}
			setBedrockAuthType(detected);
			form.setValue("key.bedrock_key_config._auth_type", detected);
		}
	}, [isBedrock, form]);

	return (
		<div data-tab="api-keys" className="space-y-4 overflow-hidden">
			<div className="flex items-start gap-4">
				<div className="flex-1">
					<FormField
						control={control}
						name={`key.name`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.name")}</FormLabel>
								<FormControl>
									<Input placeholder={t("providers.keys.productionKey")} type="text" {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>
				<FormField
					control={control}
					name={`key.weight`}
					render={({ field }) => (
						<FormItem>
							<div className="flex items-center gap-2">
								<FormLabel>{t("providersKeyForm.weight")}</FormLabel>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<span>
												<Info className="text-muted-foreground h-3 w-3" />
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p>{t("providersKeyForm.weightTooltip")}</p>
										</TooltipContent>
									</Tooltip>
								</TooltipProvider>
							</div>
							<FormControl>
								<Input
									placeholder="1.0"
									className="w-[260px]"
									value={field.value === undefined || field.value === null ? "" : String(field.value)}
									onChange={(e) => {
										// Keep as string during typing to allow partial input
										field.onChange(e.target.value === "" ? "" : e.target.value);
									}}
									onBlur={(e) => {
										const v = e.target.value.trim();
										if (v !== "") {
											const num = parseFloat(v);
											if (!isNaN(num)) {
												field.onChange(num);
											}
										}
										field.onBlur();
									}}
									name={field.name}
									ref={field.ref}
									type="text"
								/>
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
			</div>
			{/* Hide API Key field for providers with dedicated auth tabs */}
			{!isAzure && !isBedrock && !isVertex && (
				<FormField
					control={control}
					name={`key.value`}
					render={({ field }) => (
						<FormItem>
							<FormLabel>{isVLLM ? t("providersKeyForm.apiKeyOptional") : t("providersKeyForm.apiKey")}</FormLabel>
							<FormControl>
								<EnvVarInput placeholder={t("providers.keys.apiKeyPlaceholder")} type="text" {...field} />
							</FormControl>
							<FormMessage />
						</FormItem>
					)}
				/>
			)}
			{!isVLLM && (
				<>
					<FormField
						control={control}
						name={`key.models`}
						render={({ field }) => (
							<FormItem>
								<div className="flex items-center gap-2">
									<FormLabel>{t("providersKeyForm.allowedModels")}</FormLabel>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<span>
													<Info className="text-muted-foreground h-3 w-3" />
												</span>
											</TooltipTrigger>
											<TooltipContent>
												<p>{t("providersKeyForm.allowedModelsTooltip")}</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<FormControl>
									<ModelMultiselect
										data-testid="api-keys-models-multiselect"
										provider={providerName}
										allowAllOption={true}
										value={field.value || []}
										onChange={(models: string[]) => {
											const hadStar = (field.value || []).includes("*");
											const hasStar = models.includes("*");
											if (!hadStar && hasStar) {
												field.onChange(["*"]);
											} else if (hadStar && hasStar && models.length > 1) {
												field.onChange(models.filter((m: string) => m !== "*"));
											} else {
												field.onChange(models);
											}
										}}
										placeholder={
											(field.value || []).includes("*")
												? t("providersKeyForm.allModelsAllowed")
												: (field.value || []).length === 0
													? t("providersKeyForm.noModelsDenyAll")
													: t("providersKeyForm.searchModels")
										}
										unfiltered={true}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={control}
						name={`key.blacklisted_models`}
						render={({ field }) => (
							<FormItem data-testid="apikey-blacklisted-models-field">
								<div className="flex items-center gap-2">
									<FormLabel>{t("providersKeyForm.blockedModels")}</FormLabel>
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<span>
													<Info className="text-muted-foreground h-3 w-3" />
												</span>
											</TooltipTrigger>
											<TooltipContent className="max-w-sm">
												<p>{t("providersKeyForm.blockedModelsTooltip")}</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								</div>
								<FormControl>
									<ModelMultiselect
										data-testid="api-keys-blocked-models-multiselect"
										provider={providerName}
										allowAllOption={true}
										value={field.value || []}
										onChange={(models: string[]) => {
											const hadStar = (field.value || []).includes("*");
											const hasStar = models.includes("*");
											if (!hadStar && hasStar) {
												field.onChange(["*"]);
											} else if (hadStar && hasStar && models.length > 1) {
												field.onChange(models.filter((m: string) => m !== "*"));
											} else {
												field.onChange(models);
											}
										}}
										placeholder={
											(field.value || []).includes("*")
												? t("providersKeyForm.allModelsBlocked")
												: (field.value || []).length === 0
													? t("providersKeyForm.noModelsBlocked")
													: t("providersKeyForm.searchModels")
										}
										unfiltered={true}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={control}
						name={`key.aliases`}
						render={({ field }) => (
							<FormItem data-testid="apikey-aliases-field">
								<FormLabel>{t("providersKeyForm.aliases")}</FormLabel>
								<FormDescription>{t("providersKeyForm.aliasesDesc")}</FormDescription>
								<FormControl>
									<div data-testid="apikey-aliases-table">
										<HeadersTable
											label=""
											value={normalizeAliasesValue(field.value)}
											onChange={(next) => {
												form.clearErrors("key.aliases");
												field.onChange(Object.keys(next).length > 0 ? next : {});
											}}
											keyPlaceholder={t("providersKeyForm.requestModelName")}
											valuePlaceholder={t("providersKeyForm.deploymentPlaceholder")}
											renderValueInput={({ value: cellValue, onChange, placeholder, disabled }: CellRenderParams) => (
												<ModelMultiselect
													isSingleSelect
													provider={providerName}
													value={cellValue}
													onChange={onChange}
													placeholder={placeholder ?? t("providersKeyForm.deploymentPlaceholder")}
													disabled={disabled}
													unfiltered={true}
												/>
											)}
										/>
									</div>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</>
			)}
			{supportsBatchAPI && !isBedrock && !isAzure && <BatchAPIFormField control={control} form={form} />}
			{isAzure && (
				<div className="space-y-4">
					<Separator className="my-6" />
					<div className="space-y-2">
						<FormLabel>{t("providersKeyForm.authMethod")}</FormLabel>
						<Tabs
							value={azureAuthType}
							onValueChange={(v) => {
								setAzureAuthType(v as "api_key" | "entra_id" | "default_credential");
								form.setValue("key.azure_key_config._auth_type", v, { shouldDirty: true, shouldValidate: true });
								if (v === "entra_id" || v === "default_credential") {
									// Clear API key when switching away from API Key
									form.setValue("key.value", undefined, { shouldDirty: true });
								}
								if (v === "api_key" || v === "default_credential") {
									// Clear Entra ID fields when switching away from Entra ID
									form.setValue("key.azure_key_config.client_id", undefined, { shouldDirty: true });
									form.setValue("key.azure_key_config.client_secret", undefined, { shouldDirty: true });
									form.setValue("key.azure_key_config.tenant_id", undefined, { shouldDirty: true });
									form.setValue("key.azure_key_config.scopes", undefined, { shouldDirty: true });
								}
							}}
						>
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger data-testid="apikey-azure-default-credential-tab" value="default_credential">
									{t("providersKeyForm.azure.defaultCredential")}
								</TabsTrigger>
								<TabsTrigger data-testid="apikey-azure-api-key-tab" value="api_key">
									{t("providersKeyForm.azure.apiKey")}
								</TabsTrigger>
								<TabsTrigger data-testid="apikey-azure-entra-id-tab" value="entra_id">
									{t("providersKeyForm.azure.entraId")}
								</TabsTrigger>
							</TabsList>
						</Tabs>
					</div>
					{azureAuthType === "api_key" && (
						<FormField
							control={control}
							name={`key.value`}
							render={({ field }) => (
								<FormItem>
									<FormLabel>
										{isVertex ? t("providersKeyForm.apiKeyGeminiOnly") : isVLLM ? t("providersKeyForm.apiKeyOptional") : t("providersKeyForm.apiKey")}
									</FormLabel>
									<FormControl>
										<EnvVarInput placeholder={t("providers.keys.apiKeyPlaceholder")} type="text" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					)}
					{azureAuthType === "default_credential" && (
						<p className="text-muted-foreground text-sm">{t("providersKeyForm.azure.defaultCredentialDesc")}</p>
					)}

					<FormField
						control={control}
						name={`key.azure_key_config.endpoint`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.azure.endpoint")}</FormLabel>
								<FormControl>
									<EnvVarInput placeholder={t("providersKeyForm.azure.endpointPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					{azureAuthType === "entra_id" && (
						<>
							<FormField
								control={control}
								name={`key.azure_key_config.client_id`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.azure.clientId")}</FormLabel>
										<FormControl>
											<EnvVarInput placeholder={t("providersKeyForm.azure.clientIdPlaceholder")} {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.azure_key_config.client_secret`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.azure.clientSecret")}</FormLabel>
										<FormControl>
											<EnvVarInput placeholder={t("providersKeyForm.azure.clientSecretPlaceholder")} {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.azure_key_config.tenant_id`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.azure.tenantId")}</FormLabel>
										<FormControl>
											<EnvVarInput placeholder={t("providersKeyForm.azure.tenantIdPlaceholder")} {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.azure_key_config.scopes`}
								render={({ field }) => (
									<FormItem>
										<div className="flex items-center gap-2">
											<FormLabel>{t("providersKeyForm.azure.scopes")}</FormLabel>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<span>
															<Info className="text-muted-foreground h-3 w-3" />
														</span>
													</TooltipTrigger>
													<TooltipContent>
														<p>{t("providersKeyForm.azure.scopesTooltip")}</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										</div>
										<FormControl>
											<TagInput
												data-testid="apikey-azure-scopes-input"
												placeholder={t("providersKeyForm.azure.scopesPlaceholder")}
												value={field.value ?? []}
												onValueChange={field.onChange}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</>
					)}
					{supportsBatchAPI && <BatchAPIFormField control={control} form={form} />}
				</div>
			)}
			{isVertex && (
				<div className="space-y-4">
					<Separator className="my-6" />
					<div className="space-y-2">
						<FormLabel>{t("providersKeyForm.authMethod")}</FormLabel>
						<Tabs
							value={vertexAuthType}
							onValueChange={(v) => {
								setVertexAuthType(v as "service_account" | "service_account_json" | "api_key");
								form.setValue("key.vertex_key_config._auth_type", v, { shouldDirty: true, shouldValidate: true });
								if (v === "service_account" || v === "api_key") {
									// Clear auth credentials when switching away from service account JSON
									form.setValue("key.vertex_key_config.auth_credentials", undefined, { shouldDirty: true });
								}
								if (v === "service_account" || v === "service_account_json") {
									// Clear API key when switching away from API Key
									form.setValue("key.value", undefined, { shouldDirty: true });
								}
							}}
						>
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger data-testid="apikey-vertex-service-account-tab" value="service_account">
									{t("providersKeyForm.vertex.serviceAccountAttached")}
								</TabsTrigger>
								<TabsTrigger data-testid="apikey-vertex-service-account-json-tab" value="service_account_json">
									{t("providersKeyForm.vertex.serviceAccountJson")}
								</TabsTrigger>
								<TabsTrigger data-testid="apikey-vertex-api-key-tab" value="api_key">
									{t("providersKeyForm.vertex.apiKey")}
								</TabsTrigger>
							</TabsList>
						</Tabs>
						{vertexAuthType === "service_account" && (
							<p className="text-muted-foreground text-sm">{t("providersKeyForm.vertex.serviceAccountDesc")}</p>
						)}
					</div>

					<FormField
						control={control}
						name={`key.vertex_key_config.project_id`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.vertex.projectId")}</FormLabel>
								<FormControl>
									<EnvVarInput placeholder={t("providersKeyForm.vertex.projectIdPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={control}
						name={`key.vertex_key_config.project_number`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.vertex.projectNumber")}</FormLabel>
								<FormControl>
									<EnvVarInput placeholder={t("providersKeyForm.vertex.projectNumberPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={control}
						name={`key.vertex_key_config.region`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.vertex.region")}</FormLabel>
								<FormControl>
									<EnvVarInput placeholder={t("providersKeyForm.vertex.regionPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>

					{vertexAuthType === "service_account_json" && (
						<FormField
							control={control}
							name={`key.vertex_key_config.auth_credentials`}
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("providersKeyForm.vertex.authCredentials")}</FormLabel>
									<FormDescription>{t("providersKeyForm.vertex.authCredentialsDesc")}</FormDescription>
									<FormControl>
										<EnvVarInput
											data-testid="apikey-vertex-auth-credentials-input"
											variant="textarea"
											rows={4}
											placeholder={t("providersKeyForm.vertex.authCredentialsPlaceholder")}
											inputClassName="font-mono text-sm"
											{...field}
										/>
									</FormControl>
									{isRedacted(field.value?.value ?? "") && (
										<div className="text-muted-foreground mt-1 flex items-center gap-1 text-xs">
											<Info className="h-3 w-3" />
											<span>{t("providersKeyForm.vertex.credentialsStored")}</span>
										</div>
									)}
									<FormMessage />
								</FormItem>
							)}
						/>
					)}

					{vertexAuthType === "api_key" && (
						<FormField
							control={control}
							name={`key.value`}
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("providersKeyForm.apiKeyGeminiOnly")}</FormLabel>
									<FormControl>
										<EnvVarInput data-testid="apikey-vertex-api-key-input" placeholder={t("providers.keys.apiKeyPlaceholder")} type="text" {...field} />
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					)}
				</div>
			)}
			{isReplicate && (
				<div className="space-y-4">
					<Separator className="my-6" />
					<FormField
						control={control}
						name="key.replicate_key_config.use_deployments_endpoint"
						render={({ field }) => (
							<FormItem className="flex flex-row items-center justify-between rounded-sm border p-2">
								<div className="space-y-1.5">
									<FormLabel>{t("providersKeyForm.replicate.useDeployments")}</FormLabel>
									<FormDescription>{t("providersKeyForm.replicate.useDeploymentsDesc")}</FormDescription>
								</div>
								<FormControl>
									<Switch checked={field.value ?? false} onCheckedChange={field.onChange} />
								</FormControl>
							</FormItem>
						)}
					/>
				</div>
			)}
			{isVLLM && (
				<div className="space-y-4">
					<Separator className="my-6" />
					<FormField
						control={control}
						name="key.vllm_key_config.url"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.vllm.serverUrl")}</FormLabel>
								<FormDescription>{t("providersKeyForm.vllm.serverUrlDesc")}</FormDescription>
								<FormControl>
									<EnvVarInput data-testid="key-input-vllm-url" placeholder={t("providersKeyForm.vllm.serverUrlPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					<FormField
						control={control}
						name="key.vllm_key_config.model_name"
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.vllm.modelName")}</FormLabel>
								<FormDescription>{t("providersKeyForm.vllm.modelNameDesc")}</FormDescription>
								<FormControl>
									<Input data-testid="key-input-vllm-model-name" placeholder={t("providersKeyForm.vllm.modelNamePlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>
			)}
			{isKeylessProvider && (
				<div className="space-y-4">
					<FormField
						control={control}
						name={`key.${isOllama ? "ollama_key_config" : "sgl_key_config"}.url`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.vllm.serverUrl")}</FormLabel>
								<FormDescription>
									{isOllama ? t("providersKeyForm.ollama.serverUrlDesc") : t("providersKeyForm.sgl.serverUrlDesc")}
								</FormDescription>
								<FormControl>
									<EnvVarInput
										data-testid={`key-input-${isOllama ? "ollama" : "sgl"}-url`}
										placeholder={isOllama ? t("providersKeyForm.ollama.serverUrlPlaceholder") : t("providersKeyForm.sgl.serverUrlPlaceholder")}
										{...field}
									/>
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
				</div>
			)}
			{isBedrock && (
				<div className="space-y-4">
					<Separator className="my-6" />
					<div className="space-y-2">
						<FormLabel>{t("providersKeyForm.authMethod")}</FormLabel>
						<Tabs
							value={bedrockAuthType}
							onValueChange={(v) => {
								setBedrockAuthType(v as "iam_role" | "explicit" | "api_key");
								form.setValue("key.bedrock_key_config._auth_type", v, { shouldDirty: true, shouldValidate: true });
								if (v === "iam_role") {
									// Clear explicit credentials and API key when switching to IAM Role
									form.setValue("key.bedrock_key_config.access_key", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.secret_key", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.session_token", undefined, { shouldDirty: true });
									form.setValue("key.value", undefined, { shouldDirty: true });
								} else if (v === "explicit") {
									// Clear API key when switching to Explicit Credentials
									form.setValue("key.value", undefined, { shouldDirty: true });
								} else if (v === "api_key") {
									// Clear AWS credentials and assume-role fields when switching to API Key
									form.setValue("key.bedrock_key_config.access_key", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.secret_key", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.session_token", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.role_arn", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.external_id", undefined, { shouldDirty: true });
									form.setValue("key.bedrock_key_config.session_name", undefined, { shouldDirty: true });
								}
							}}
						>
							<TabsList className="grid w-full grid-cols-3">
								<TabsTrigger data-testid="apikey-bedrock-iam-role-tab" value="iam_role">
									{t("providersKeyForm.bedrock.iamRole")}
								</TabsTrigger>
								<TabsTrigger data-testid="apikey-bedrock-explicit-credentials-tab" value="explicit">
									{t("providersKeyForm.bedrock.explicitCredentials")}
								</TabsTrigger>
								<TabsTrigger data-testid="apikey-bedrock-api-key-tab" value="api_key">
									{t("providersKeyForm.bedrock.apiKey")}
								</TabsTrigger>
							</TabsList>
						</Tabs>
						{bedrockAuthType === "iam_role" && (
							<p className="text-muted-foreground text-sm">{t("providersKeyForm.bedrock.iamRoleDesc")}</p>
						)}
						{bedrockAuthType === "api_key" && (
							<p className="text-muted-foreground text-sm">{t("providersKeyForm.bedrock.apiKeyDesc")}</p>
						)}
					</div>

					{bedrockAuthType === "explicit" && (
						<>
							<FormField
								control={control}
								name={`key.bedrock_key_config.access_key`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.bedrock.accessKey")}</FormLabel>
										<FormControl>
											<EnvVarInput placeholder={t("providersKeyForm.bedrock.accessKeyPlaceholder")} {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.bedrock_key_config.secret_key`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.bedrock.secretKey")}</FormLabel>
										<FormControl>
											<EnvVarInput placeholder={t("providersKeyForm.bedrock.secretKeyPlaceholder")} {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.bedrock_key_config.session_token`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.bedrock.sessionToken")}</FormLabel>
										<FormControl>
											<EnvVarInput placeholder={t("providersKeyForm.bedrock.sessionTokenPlaceholder")} {...field} />
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</>
					)}

					{bedrockAuthType === "api_key" && (
						<FormField
							control={control}
							name={`key.value`}
							render={({ field }) => (
								<FormItem>
									<FormLabel>{t("providersKeyForm.bedrock.apiKey")}</FormLabel>
									<FormControl>
										<EnvVarInput
											data-testid="apikey-bedrock-api-key-input"
											placeholder={t("providersKeyForm.bedrock.apiKeyPlaceholder")}
											type="text"
											{...field}
										/>
									</FormControl>
									<FormMessage />
								</FormItem>
							)}
						/>
					)}

					<FormField
						control={control}
						name={`key.bedrock_key_config.region`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.bedrock.region")}</FormLabel>
								<FormControl>
									<EnvVarInput placeholder={t("providersKeyForm.bedrock.regionPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					{bedrockAuthType !== "api_key" && (
						<>
							<FormField
								control={control}
								name={`key.bedrock_key_config.role_arn`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.bedrock.assumeRoleArn")}</FormLabel>
										<FormDescription>{t("providersKeyForm.bedrock.assumeRoleArnDesc")}</FormDescription>
										<FormControl>
											<EnvVarInput
												data-testid="apikey-bedrock-role-arn-input"
												placeholder={t("providersKeyForm.bedrock.assumeRoleArnPlaceholder")}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.bedrock_key_config.external_id`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.bedrock.externalId")}</FormLabel>
										<FormDescription>{t("providersKeyForm.bedrock.externalIdDesc")}</FormDescription>
										<FormControl>
											<EnvVarInput
												data-testid="apikey-bedrock-external-id-input"
												placeholder={t("providersKeyForm.bedrock.externalIdPlaceholder")}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
							<FormField
								control={control}
								name={`key.bedrock_key_config.session_name`}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("providersKeyForm.bedrock.sessionName")}</FormLabel>
										<FormDescription>{t("providersKeyForm.bedrock.sessionNameDesc")}</FormDescription>
										<FormControl>
											<EnvVarInput
												data-testid="apikey-bedrock-session-name-input"
												placeholder={t("providersKeyForm.bedrock.sessionNamePlaceholder")}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>
						</>
					)}
					<FormField
						control={control}
						name={`key.bedrock_key_config.arn`}
						render={({ field }) => (
							<FormItem>
								<FormLabel>{t("providersKeyForm.bedrock.arn")}</FormLabel>
								<FormControl>
									<EnvVarInput placeholder={t("providersKeyForm.bedrock.arnPlaceholder")} {...field} />
								</FormControl>
								<FormMessage />
							</FormItem>
						)}
					/>
					{supportsBatchAPI && <BatchAPIFormField control={control} form={form} />}
				</div>
			)}
		</div>
	);
}
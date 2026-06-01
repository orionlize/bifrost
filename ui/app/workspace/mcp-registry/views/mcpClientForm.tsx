import { Button } from "@/components/ui/button";
import { EnvVarInput } from "@/components/ui/envVarInput";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { HeadersTable } from "@/components/ui/headersTable";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { useT } from "@/lib/i18n";
import { getErrorMessage, useCreateMCPClientMutation } from "@/lib/store";
import { CreateMCPClientRequest, EnvVar, MCPConnectionType, MCPStdioConfig } from "@/lib/types/mcp";
import { parseArrayFromText } from "@/lib/utils/array";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { Info } from "lucide-react";
import React, { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { MCPHeadersAuthorizer } from "./mcpHeadersAuthorizer";
import { OAuth2Authorizer } from "./oauth2Authorizer";

interface ClientFormProps {
	open: boolean;
	onClose: () => void;
	onSaved: () => void;
}

const emptyStdioConfig: MCPStdioConfig = {
	command: "",
	args: [],
	envs: [],
};

const emptyEnvVar: EnvVar = { value: "", env_var: "", from_env: false };

const emptyForm: CreateMCPClientRequest = {
	name: "",
	is_code_mode_client: false,
	is_ping_available: true,
	connection_type: "http",
	connection_string: emptyEnvVar,
	stdio_config: emptyStdioConfig,
	auth_type: "none",
};

const ClientForm: React.FC<ClientFormProps> = ({ open, onClose, onSaved }) => {
	const t = useT();
	const hasCreateMCPClientAccess = useRbac(RbacResource.MCPGateway, RbacOperation.Create);
	const { toast } = useToast();
	const [createMCPClient] = useCreateMCPClientMutation();

	const [isLoading, setIsLoading] = useState(false);
	const [argsText, setArgsText] = useState("");
	const [envsText, setEnvsText] = useState("");
	const [scopesText, setScopesText] = useState("");
	const [oauthFlow, setOauthFlow] = useState<{
		authorizeUrl: string;
		oauthConfigId: string;
		mcpClientId: string;
		isPerUserOauth?: boolean;
	} | null>(null);

	// Per-user-headers admin flow: admin declares the required key names
	// (perUserHeaderKeys), then on Create the MCPHeadersAuthorizer dialog
	// runs a sample-values verify and returns discovered tools. The form
	// then persists the MCP client with those tools attached — first-time
	// end users skip re-discovery that way. Mirrors the OAuth2Authorizer
	// flow exactly: nothing is persisted until the test succeeds.
	const [perUserHeaderKeys, setPerUserHeaderKeys] = useState<string[]>([]);
	const [newHeaderKeyInput, setNewHeaderKeyInput] = useState("");
	const [headersFlow, setHeadersFlow] = useState<{ payload: CreateMCPClientRequest } | null>(null);

	// UI splits the canonical `auth_type` into two dropdowns:
	//   - authKind: none | headers | oauth
	//   - authScope: shared | per_user (hidden when authKind = none)
	// They recombine into the wire `auth_type` ("oauth", "per_user_oauth",
	// "headers", "per_user_headers", "none") so the backend contract is
	// unchanged.
	const [authScope, setAuthScope] = useState<"shared" | "per_user">("shared");

	const methods = useForm<CreateMCPClientRequest>({ defaultValues: emptyForm });
	const { control, handleSubmit, setValue, watch, reset, setError, clearErrors } = methods;

	const connectionType = watch("connection_type");
	const authType = watch("auth_type");
	const headers = watch("headers");

	const authKind: "none" | "headers" | "oauth" =
		authType === "oauth" || authType === "per_user_oauth"
			? "oauth"
			: authType === "headers" || authType === "per_user_headers"
				? "headers"
				: "none";

	const applyAuthKind = (kind: "none" | "headers" | "oauth") => {
		if (kind === "none") {
			setValue("auth_type", "none");
			return;
		}
		if (kind === "oauth") {
			setValue("auth_type", authScope === "per_user" ? "per_user_oauth" : "oauth");
			return;
		}
		setValue("auth_type", authScope === "per_user" ? "per_user_headers" : "headers");
	};

	const applyAuthScope = (scope: "shared" | "per_user") => {
		setAuthScope(scope);
		if (authKind === "oauth") {
			setValue("auth_type", scope === "per_user" ? "per_user_oauth" : "oauth");
		} else if (authKind === "headers") {
			setValue("auth_type", scope === "per_user" ? "per_user_headers" : "headers");
		}
	};

	// Inline header validation (shown live as user edits headers).
	// Both "headers" and "per_user_headers" auth types persist the static
	// headers map via the submit path (see "headers" property of payload
	// below), so the validation gate must cover both — otherwise an empty
	// static header in the per-user flow slips past client validation and
	// opens MCPHeadersAuthorizer with an invalid config the server has to
	// reject.
	let headersValidationError: string | null = null;
	if ((connectionType === "http" || connectionType === "sse") && (authType === "headers" || authType === "per_user_headers") && headers) {
		for (const [key, envVar] of Object.entries(headers)) {
			if (!envVar.value && !envVar.env_var) {
				headersValidationError = t("mcp.form.headerValueRequired", { key });
				break;
			}
		}
	}

	// Reset form state when dialog opens
	useEffect(() => {
		if (open) {
			reset(emptyForm);
			setArgsText("");
			setEnvsText("");
			setScopesText("");
			setOauthFlow(null);
			setHeadersFlow(null);
			setPerUserHeaderKeys([]);
			setNewHeaderKeyInput("");
			setAuthScope("shared");
			setIsLoading(false);
		}
	}, [open, reset]);

	const onSubmit = async (data: CreateMCPClientRequest) => {
		let hasErrors = false;

		if (connectionType === "http" || connectionType === "sse") {
			const connVal = data.connection_string?.value || "";
			if (!connVal.trim()) {
				setError("connection_string", { message: t("mcp.form.validation.urlRequired") });
				hasErrors = true;
			} else if (!/^((https?:\/\/.+)|(env\.[A-Z_]+))$/.test(connVal)) {
				setError("connection_string", {
					message: t("mcp.form.validation.urlFormat"),
				});
				hasErrors = true;
			}
		}

		if (connectionType === "stdio") {
			const cmd = data.stdio_config?.command || "";
			if (!cmd.trim()) {
				setError("stdio_config.command", { message: t("mcp.form.validation.commandRequired") });
				hasErrors = true;
			} else if (/[<>|&;]/.test(cmd)) {
				setError("stdio_config.command", { message: t("mcp.form.validation.commandInvalid") });
				hasErrors = true;
			}
		}

		if (authType === "oauth" || authType === "per_user_oauth") {
			if (data.oauth_config?.authorize_url && !/^https?:\/\/.+$/.test(data.oauth_config.authorize_url)) {
				setError("oauth_config.authorize_url", { message: t("mcp.form.validation.authorizeUrl") });
				hasErrors = true;
			}
			if (data.oauth_config?.token_url && !/^https?:\/\/.+$/.test(data.oauth_config.token_url)) {
				setError("oauth_config.token_url", { message: t("mcp.form.validation.tokenUrl") });
				hasErrors = true;
			}
			if (data.oauth_config?.registration_url && !/^https?:\/\/.+$/.test(data.oauth_config.registration_url)) {
				setError("oauth_config.registration_url", { message: t("mcp.form.validation.registrationUrl") });
				hasErrors = true;
			}
		}

		if (authType === "per_user_headers") {
			if (perUserHeaderKeys.length === 0) {
				toast({
					title: t("mcp.form.headerKeysRequired"),
					description: t("mcp.form.headerKeysRequiredDesc"),
					variant: "destructive",
				});
				hasErrors = true;
			}
		}

		if (headersValidationError || hasErrors) return;

		setIsLoading(true);

		const payload: CreateMCPClientRequest = {
			...data,
			stdio_config:
				connectionType === "stdio"
					? {
							command: data.stdio_config?.command || "",
							args: parseArrayFromText(argsText),
							envs: parseArrayFromText(envsText),
						}
					: undefined,
			oauth_config:
				authType === "oauth" || authType === "per_user_oauth"
					? {
							client_id: data.oauth_config?.client_id ?? emptyEnvVar,
							client_secret:
								data.oauth_config?.client_secret?.value || data.oauth_config?.client_secret?.from_env
									? data.oauth_config.client_secret
									: undefined,
							authorize_url: data.oauth_config?.authorize_url || undefined,
							token_url: data.oauth_config?.token_url || undefined,
							registration_url: data.oauth_config?.registration_url || undefined,
							scopes: scopesText.trim() ? parseArrayFromText(scopesText) : undefined,
							server_url: data.connection_string?.value || undefined,
						}
					: undefined,
			// "headers" and "per_user_headers" both can carry static admin
			// headers on data.headers (per-user values are submitted
			// separately by end users). Persist when present.
			headers:
				(authType === "headers" || authType === "per_user_headers") && data.headers && Object.keys(data.headers).length > 0
					? data.headers
					: undefined,
			per_user_header_keys: authType === "per_user_headers" ? perUserHeaderKeys : undefined,
			tools_to_execute: ["*"],
		};

		// Per-user-headers: stash the payload and open the headers test
		// dialog. The dialog collects sample values and POSTs once to
		// /api/mcp/client where the server verifies, discovers tools,
		// and persists in a single round-trip. Mirrors the per-user
		// OAuth flow's single-call shape.
		if (authType === "per_user_headers") {
			setIsLoading(false);
			setHeadersFlow({ payload });
			return;
		}

		try {
			const response = await createMCPClient(payload).unwrap();

			if (response.status === "pending_oauth" && response.authorize_url) {
				setIsLoading(false);
				setOauthFlow({
					authorizeUrl: response.authorize_url,
					oauthConfigId: response.oauth_config_id,
					mcpClientId: response.mcp_client_id,
					isPerUserOauth: authType === "per_user_oauth",
				});
			} else {
				setIsLoading(false);
				toast({ title: t("mcp.success"), description: t("mcp.form.serverCreated") });
				onSaved();
				onClose();
			}
		} catch (error) {
			setIsLoading(false);
			toast({ title: t("mcp.error"), description: getErrorMessage(error), variant: "destructive" });
		}
	};

	return (
		<Sheet open={open} onOpenChange={(open) => !open && !oauthFlow && onClose()}>
			<SheetContent className="flex w-full flex-col overflow-x-hidden px-0">
				<SheetHeader className="flex flex-col items-start px-7 pt-8">
					<SheetTitle>{t("mcp.form.newTitle")}</SheetTitle>
					<SheetDescription>{t("mcp.form.newDescription")}</SheetDescription>
				</SheetHeader>

				<Form {...methods}>
					<form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
						<div className="flex-1 space-y-4 overflow-y-auto px-8 pb-8">
							{/* Name */}
							<FormField
								control={control}
								name="name"
								rules={{
									required: t("mcp.form.validation.nameRequired"),
									minLength: { value: 3, message: t("mcp.form.validation.nameMin") },
									maxLength: { value: 50, message: t("mcp.form.validation.nameMax") },
									validate: {
										format: (v) => /^[a-zA-Z0-9_]+$/.test(v) || t("mcp.form.validation.nameFormat"),
										noLeadingDigit: (v) => !/^[0-9]/.test(v) || t("mcp.form.validation.nameNoLeadingDigit"),
									},
								}}
								render={({ field }) => (
									<FormItem>
										<FormLabel>{t("mcp.form.name")}</FormLabel>
										<FormControl>
											<Input
												id="client-name"
												data-testid="client-name-input"
												placeholder={t("mcp.form.serverName")}
												maxLength={50}
												{...field}
											/>
										</FormControl>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Connection Type */}
							<FormField
								control={control}
								name="connection_type"
								render={({ field }) => (
									<FormItem className="w-full">
										<FormLabel>{t("mcp.form.connectionType")}</FormLabel>
										<Select
											value={field.value}
											onValueChange={(value: MCPConnectionType) => {
												field.onChange(value);
												if (value === "stdio") {
													setValue("auth_type", "none");
													setValue("headers", undefined);
													setValue("oauth_config", undefined);
												}
												clearErrors();
											}}
										>
											<FormControl>
												<SelectTrigger className="w-full" data-testid="connection-type-select">
													<SelectValue placeholder={t("mcp.form.selectConnectionType")} />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="http" data-testid="connection-type-http">
													{t("mcp.form.connectionHttp")}
												</SelectItem>
												<SelectItem value="sse" data-testid="connection-type-sse">
													{t("mcp.form.connectionSse")}
												</SelectItem>
												<SelectItem value="stdio" data-testid="connection-type-stdio">
													{t("mcp.form.connectionStdio")}
												</SelectItem>
											</SelectContent>
										</Select>
										<p className="text-muted-foreground text-xs">{t("mcp.form.connectionTypeImmutable")}</p>
										<FormMessage />
									</FormItem>
								)}
							/>

							{/* Code Mode Server */}
							<FormField
								control={control}
								name="is_code_mode_client"
								render={({ field }) => (
									<div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
										<div className="flex items-center gap-2">
											<Label htmlFor="code-mode">{t("mcp.form.codeMode")}</Label>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<a
															href="https://docs.getbifrost.ai/mcp/code-mode"
															target="_blank"
															rel="noopener noreferrer"
															data-testid="code-mode-link-help"
															className="text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded focus-visible:ring-2 focus-visible:outline-none"
															aria-label={t("mcp.form.codeModeAria")}
														>
															<Info className="h-4 w-4 cursor-help" />
														</a>
													</TooltipTrigger>
													<TooltipContent>
														<p>{t("mcp.form.codeModeLearnMore")}</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										</div>
										<Switch id="code-mode" data-testid="code-mode-switch" checked={field.value || false} onCheckedChange={field.onChange} />
									</div>
								)}
							/>

							{/* Ping Available */}
							<FormField
								control={control}
								name="is_ping_available"
								render={({ field }) => (
									<div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
										<div className="flex items-center gap-2">
											<Label htmlFor="ping-available">{t("mcp.form.pingHealth")}</Label>
											<TooltipProvider>
												<Tooltip>
													<TooltipTrigger asChild>
														<Info className="text-muted-foreground h-4 w-4 cursor-help" />
													</TooltipTrigger>
													<TooltipContent className="max-w-xs">
														<p>{t("mcp.form.pingHealthTooltip")}</p>
													</TooltipContent>
												</Tooltip>
											</TooltipProvider>
										</div>
										<Switch
											id="ping-available"
											data-testid="mcp-is-ping-available"
											checked={field.value === true}
											onCheckedChange={field.onChange}
										/>
									</div>
								)}
							/>

							{(connectionType === "http" || connectionType === "sse") && (
								<>
									{/* Connection URL */}
									<FormField
										control={control}
										name="connection_string"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("mcp.form.connectionUrl")}</FormLabel>
												<EnvVarInput
													value={field.value}
													onChange={(value) => {
														field.onChange(value);
														clearErrors("connection_string");
													}}
													placeholder={t("mcp.form.connectionUrlPlaceholder")}
													data-testid="connection-url-input"
												/>
												<FormMessage />
											</FormItem>
										)}
									/>

									{/* Auth Type */}
									<FormItem className="w-full">
										<FormLabel>{t("mcp.form.authType")}</FormLabel>
										<Select value={authKind} onValueChange={(value: "none" | "headers" | "oauth") => applyAuthKind(value)}>
											<FormControl>
												<SelectTrigger className="w-full" data-testid="auth-type-select">
													<SelectValue placeholder={t("mcp.form.selectAuthType")} />
												</SelectTrigger>
											</FormControl>
											<SelectContent>
												<SelectItem value="none" data-testid="auth-type-none">
													{t("mcp.authType.none")}
												</SelectItem>
												<SelectItem value="headers" data-testid="auth-type-headers">
													{t("mcp.authType.headers")}
												</SelectItem>
												<SelectItem value="oauth" data-testid="auth-type-oauth">
													{t("mcp.form.oauth20")}
												</SelectItem>
											</SelectContent>
										</Select>
									</FormItem>

									{/* Auth Scope — only meaningful when there's an auth flow */}
									{authKind !== "none" && (
										<FormItem className="w-full">
											<FormLabel>{t("mcp.form.authScope")}</FormLabel>
											<Select value={authScope} onValueChange={(value: "shared" | "per_user") => applyAuthScope(value)}>
												<FormControl>
													<SelectTrigger className="w-full" data-testid="auth-scope-select">
														<SelectValue placeholder={t("mcp.form.selectAuthScope")} />
													</SelectTrigger>
												</FormControl>
												<SelectContent>
													<SelectItem value="shared" data-testid="auth-scope-shared">
														{t("mcp.form.scopeShared")}
													</SelectItem>
													<SelectItem value="per_user" data-testid="auth-scope-per-user">
														{t("mcp.form.scopePerUser")}
													</SelectItem>
												</SelectContent>
											</Select>
										</FormItem>
									)}

									{authType === "headers" && (
										<FormField
											control={control}
											name="headers"
											render={({ field }) => (
												<FormItem data-testid="mcp-headers-table">
													<HeadersTable
														value={field.value || {}}
														onChange={field.onChange}
														keyPlaceholder={t("mcp.form.headerName")}
														valuePlaceholder={t("mcp.form.headerValue")}
														label={t("mcp.form.headers")}
														useEnvVarInput
													/>
													{headersValidationError && <p className="text-destructive text-xs">{headersValidationError}</p>}
													<FormMessage />
												</FormItem>
											)}
										/>
									)}

									{authType === "per_user_headers" && (
										<div className="space-y-4">
											{/* Required header keys (admin schema). Same Textarea +
											    comma-separated pattern as workspace/config security
											    Required Headers, so the two surfaces stay visually
											    consistent. End users supply values per-user at first
											    tool use via the inline auth landing page. */}
											<div className="space-y-1">
												<div className="space-y-0.5">
													<div className="text-sm font-medium">{t("mcp.form.requiredHeaders")}</div>
													<p className="text-muted-foreground text-sm">{t("mcp.form.perUserHeadersDesc")}</p>
												</div>
												<Textarea
													id="per-user-header-keys"
													data-testid="per-user-header-keys-textarea"
													className="h-24"
													placeholder={t("mcp.sheet.extraHeadersPlaceholder")}
													value={newHeaderKeyInput}
													onChange={(e) => {
														setNewHeaderKeyInput(e.target.value);
														setPerUserHeaderKeys(parseArrayFromText(e.target.value));
													}}
												/>
											</div>

											{/* Optional static admin headers (e.g. a fixed tenant header) */}
											<FormField
												control={control}
												name="headers"
												render={({ field }) => (
													<FormItem>
														<HeadersTable
															value={field.value || {}}
															onChange={field.onChange}
															keyPlaceholder={t("mcp.form.headerName")}
															valuePlaceholder={t("mcp.form.headerValue")}
															label={t("mcp.form.staticHeaders")}
															useEnvVarInput
														/>
														{headersValidationError && <p className="text-destructive text-xs">{headersValidationError}</p>}
														<FormMessage />
													</FormItem>
												)}
											/>

											{/* Sample values are collected in the MCPHeadersAuthorizer
											    dialog that opens on Create — mirrors the OAuth flow
											    where the verification step is also a dialog, not an
											    inline panel. */}
										</div>
									)}

									{(authType === "oauth" || authType === "per_user_oauth") && (
										<Accordion type="single" collapsible className="w-full">
											<AccordionItem value="oauth-advanced" className="border-b-0">
												<AccordionTrigger className="py-0" data-testid="oauth-advanced-trigger">
													<span className="text-sm font-medium">{t("mcp.form.oauthClientAdvanced")}</span>
												</AccordionTrigger>
												<AccordionContent className="space-y-4 pt-4 pb-0">
													{/* OAuth Client ID */}
													<FormField
														control={control}
														name="oauth_config.client_id"
														render={({ field }) => (
															<FormItem>
																<div className="flex items-center gap-2">
																	<FormLabel>{t("mcp.form.oauthClientIdOptional")}</FormLabel>
																	<TooltipProvider>
																		<Tooltip>
																			<TooltipTrigger asChild>
																				<Info className="text-muted-foreground h-4 w-4 cursor-help" />
																			</TooltipTrigger>
																			<TooltipContent className="max-w-xs">
																				<p>{t("mcp.form.oauthClientIdTooltip")}</p>
																			</TooltipContent>
																		</Tooltip>
																	</TooltipProvider>
																</div>
																<FormControl>
																	<EnvVarInput
																		value={field.value}
																		onChange={field.onChange}
																		placeholder={t("mcp.form.oauthClientIdPlaceholder")}
																		data-testid="mcp-oauth-client-id"
																	/>
																</FormControl>
																<p className="text-muted-foreground text-xs">
																	{t("mcp.form.oauthClientIdHint")}
																</p>
																<FormMessage />
															</FormItem>
														)}
													/>

													{/* OAuth Client Secret */}
													<FormField
														control={control}
														name="oauth_config.client_secret"
														render={({ field }) => (
															<FormItem>
																<FormLabel>{t("mcp.form.oauthClientSecretOptional")}</FormLabel>
																<FormControl>
																	<EnvVarInput
																		value={field.value}
																		onChange={field.onChange}
																		placeholder={t("mcp.form.oauthClientSecretPlaceholder")}
																		hideValueWhenEnv
																		maskNonEnvValue
																		data-testid="mcp-oauth-client-secret"
																	/>
																</FormControl>
																<p className="text-muted-foreground text-xs">{t("mcp.form.oauthClientSecretHint")}</p>
																<FormMessage />
															</FormItem>
														)}
													/>

													{/* OAuth Authorize URL */}
													<FormField
														control={control}
														name="oauth_config.authorize_url"
														render={({ field }) => (
															<FormItem>
																<FormLabel>{t("mcp.form.oauthAuthorizeUrlOptional")}</FormLabel>
																<FormControl>
																	<Input
																		{...field}
																		value={field.value ?? ""}
																		onChange={(e) => {
																			field.onChange(e);
																			clearErrors("oauth_config.authorize_url");
																		}}
																		placeholder={t("mcp.form.oauthAuthorizeUrlPlaceholder")}
																		data-testid="mcp-oauth-authorize-url"
																	/>
																</FormControl>
																<FormMessage />
															</FormItem>
														)}
													/>

													{/* OAuth Token URL */}
													<FormField
														control={control}
														name="oauth_config.token_url"
														render={({ field }) => (
															<FormItem>
																<FormLabel>{t("mcp.form.oauthTokenUrlOptional")}</FormLabel>
																<FormControl>
																	<Input
																		{...field}
																		value={field.value ?? ""}
																		onChange={(e) => {
																			field.onChange(e);
																			clearErrors("oauth_config.token_url");
																		}}
																		placeholder={t("mcp.form.oauthTokenUrlPlaceholder")}
																		data-testid="mcp-oauth-token-url"
																	/>
																</FormControl>
																<FormMessage />
															</FormItem>
														)}
													/>

													{/* OAuth Registration URL */}
													<FormField
														control={control}
														name="oauth_config.registration_url"
														render={({ field }) => (
															<FormItem>
																<FormLabel>{t("mcp.form.oauthRegistrationUrlOptional")}</FormLabel>
																<FormControl>
																	<Input
																		{...field}
																		value={field.value ?? ""}
																		onChange={(e) => {
																			field.onChange(e);
																			clearErrors("oauth_config.registration_url");
																		}}
																		placeholder={t("mcp.form.oauthRegistrationUrlPlaceholder")}
																		data-testid="mcp-oauth-registration-url"
																	/>
																</FormControl>
																<FormMessage />
															</FormItem>
														)}
													/>

													{/* Scopes (local state, not RHF field) */}
													<div className="space-y-2">
														<Label>{t("mcp.form.oauthScopesOptional")}</Label>
														<Input
															value={scopesText}
															onChange={(e) => setScopesText(e.target.value)}
															placeholder={t("mcp.form.oauthScopesPlaceholder")}
															data-testid="mcp-oauth-scopes-input"
														/>
													</div>
												</AccordionContent>
											</AccordionItem>
										</Accordion>
									)}
								</>
							)}

							{connectionType === "stdio" && (
								<>
									<div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
										<div className="flex items-start gap-2">
											<Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-700" />
											<div className="flex-1">
												<p className="text-xs font-medium text-amber-900">{t("mcp.form.dockerNotice")}</p>
												<p className="mt-0.5 text-xs text-amber-800">{t("mcp.form.dockerNoticeExtended")}</p>
											</div>
										</div>
									</div>

									{/* STDIO Command */}
									<FormField
										control={control}
										name="stdio_config.command"
										render={({ field }) => (
											<FormItem>
												<FormLabel>{t("mcp.form.command")}</FormLabel>
												<FormControl>
													<Input
														{...field}
														value={field.value ?? ""}
														onChange={(e) => {
															field.onChange(e);
															clearErrors("stdio_config.command");
														}}
														placeholder={t("mcp.form.stdioCommandPlaceholder")}
														data-testid="stdio-command-input"
													/>
												</FormControl>
												<FormMessage />
											</FormItem>
										)}
									/>

									{/* Args (local state) */}
									<div className="space-y-2">
										<Label>{t("mcp.form.arguments")}</Label>
										<Input
											value={argsText}
											onChange={(e) => setArgsText(e.target.value)}
											placeholder={t("mcp.form.stdioArgsPlaceholder")}
											data-testid="stdio-args-input"
										/>
									</div>

									{/* Envs (local state) */}
									<div className="space-y-2">
										<Label>{t("mcp.form.envVars")}</Label>
										<Input
											value={envsText}
											onChange={(e) => setEnvsText(e.target.value)}
											placeholder={t("mcp.form.stdioEnvsPlaceholder")}
											data-testid="stdio-envs-input"
										/>
									</div>
								</>
							)}
						</div>

						{/* Form Footer */}
						<div className="dark:bg-card border-border border-t bg-white px-8 py-4">
							<div className="flex justify-end gap-2">
								<Button type="button" variant="outline" onClick={onClose} disabled={isLoading} data-testid="cancel-client-btn">
									{t("common.actions.cancel")}
								</Button>
								<TooltipProvider>
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="inline-block">
												<Button
													type="submit"
													disabled={isLoading || !hasCreateMCPClientAccess}
													isLoading={isLoading}
													data-testid="save-client-btn"
												>
													{t("common.actions.create")}
												</Button>
											</span>
										</TooltipTrigger>
										{!hasCreateMCPClientAccess && (
											<TooltipContent>
												<p>{t("mcp.form.noPermission")}</p>
											</TooltipContent>
										)}
									</Tooltip>
								</TooltipProvider>
							</div>
						</div>
					</form>
				</Form>
			</SheetContent>

			{/* OAuth Authorizer Popup */}
			{oauthFlow && (
				<OAuth2Authorizer
					open={!!oauthFlow}
					onClose={() => {
						setOauthFlow(null);
					}}
					onSuccess={() => {
						toast({ title: t("mcp.success"), description: t("mcp.form.oauthConnected") });
						setOauthFlow(null);
						onClose();
						onSaved();
					}}
					onError={(error) => {
						toast({ title: t("mcp.form.oauthError"), description: error, variant: "destructive" });
					}}
					authorizeUrl={oauthFlow.authorizeUrl}
					oauthConfigId={oauthFlow.oauthConfigId}
					mcpClientId={oauthFlow.mcpClientId}
					isPerUserOauth={oauthFlow.isPerUserOauth}
				/>
			)}

			{/* Per-user-headers create dialog. Collects sample values inline,
			    then calls POST /api/mcp/client once — the server verifies
			    upstream + discovers tools + persists atomically. Mirrors
			    the per-user OAuth flow's single-call shape. Nothing is
			    committed if the user cancels or verification fails. */}
			{headersFlow && (
				<MCPHeadersAuthorizer
					open={!!headersFlow}
					onClose={() => {
						setHeadersFlow(null);
					}}
					onSuccess={() => {
						setHeadersFlow(null);
						toast({ title: t("mcp.success"), description: t("mcp.form.headersConnected") });
						onSaved();
						onClose();
					}}
					onError={() => {
						/* error toast handled by the dialog itself */
					}}
					payload={headersFlow.payload}
					perUserHeaderKeys={perUserHeaderKeys}
				/>
			)}
		</Sheet>
	);
};

export default ClientForm;
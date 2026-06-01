import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EnvVarInput } from "@/components/ui/envVarInput";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { IS_ENTERPRISE } from "@/lib/constants/config";
import { getErrorMessage, useGetCoreConfigQuery, useUpdateCoreConfigMutation } from "@/lib/store";
import { AuthConfig, AoneOAuthConfig, CoreConfig, DefaultCoreConfig } from "@/lib/types/config";
import { EnvVar } from "@/lib/types/schemas";
import { parseArrayFromText } from "@/lib/utils/array";
import { validateOrigins } from "@/lib/utils/validation";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { useGetAuthTypeQuery } from "@enterprise/lib/store/apis/scimApi";
import { useT } from "@/lib/i18n";
import { useNavDescription, useNavTitle } from "@/lib/i18n/useNavTitle";
import { Link } from "@tanstack/react-router";
import { AlertTriangle, Info, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

export default function SecurityView() {
	const t = useT();
	const pageTitle = useNavTitle("security");
	const pageDescription = useNavDescription("security");
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig } = useGetCoreConfigQuery({ fromDB: true });
	const { data: authType, isLoading: authTypeLoading, error: authTypeError } = useGetAuthTypeQuery(undefined, { skip: !IS_ENTERPRISE });
	const config = bifrostConfig?.client_config;
	const [updateCoreConfig, { isLoading }] = useUpdateCoreConfigMutation();
	const [localConfig, setLocalConfig] = useState<CoreConfig>(DefaultCoreConfig);
	const showPasswordSection = !IS_ENTERPRISE || (!authTypeLoading && !authTypeError && authType?.type !== "sso");

	const [localValues, setLocalValues] = useState<{
		allowed_origins: string;
		allowed_headers: string;
		required_headers: string;
		whitelisted_routes: string;
	}>({
		allowed_origins: "",
		allowed_headers: "",
		required_headers: "",
		whitelisted_routes: "",
	});

	const defaultAoneOAuth = (): AoneOAuthConfig => ({
		enabled: false,
		base_url: { value: "", env_var: "", from_env: false },
		client_id: { value: "", env_var: "", from_env: false },
		client_secret: { value: "", env_var: "", from_env: false },
		redirect_uri: { value: "", env_var: "", from_env: false },
	});

	const [authConfig, setAuthConfig] = useState<AuthConfig>({
		admin_username: { value: "", env_var: "", from_env: false },
		admin_password: { value: "", env_var: "", from_env: false },
		is_enabled: false,
		disable_auth_on_inference: true,
		aone_oauth: defaultAoneOAuth(),
	});

	useEffect(() => {
		if (bifrostConfig && config) {
			setLocalConfig(config);
			setLocalValues({
				allowed_origins: config?.allowed_origins?.join(", ") || "",
				allowed_headers: config?.allowed_headers?.join(", ") || "",
				required_headers: config?.required_headers?.join(", ") || "",
				whitelisted_routes: config?.whitelisted_routes?.join(", ") || "",
			});
		}
		if (bifrostConfig?.auth_config) {
			setAuthConfig({
				...bifrostConfig.auth_config,
				aone_oauth: bifrostConfig.auth_config.aone_oauth ?? defaultAoneOAuth(),
			});
		}
	}, [config, bifrostConfig]);

	const hasChanges = useMemo(() => {
		if (!config) return false;
		const localOrigins = localConfig.allowed_origins?.slice().sort().join(",");
		const serverOrigins = config.allowed_origins?.slice().sort().join(",");
		const originsChanged = localOrigins !== serverOrigins;

		const localHeaders = localConfig.allowed_headers?.slice().sort().join(",");
		const serverHeaders = config.allowed_headers?.slice().sort().join(",");
		const headersChanged = localHeaders !== serverHeaders;

		const usernameChanged =
			authConfig.admin_username?.value !== bifrostConfig?.auth_config?.admin_username?.value ||
			authConfig.admin_username?.env_var !== bifrostConfig?.auth_config?.admin_username?.env_var ||
			authConfig.admin_username?.from_env !== bifrostConfig?.auth_config?.admin_username?.from_env;
		const passwordChanged =
			authConfig.admin_password?.value !== bifrostConfig?.auth_config?.admin_password?.value ||
			authConfig.admin_password?.env_var !== bifrostConfig?.auth_config?.admin_password?.env_var ||
			authConfig.admin_password?.from_env !== bifrostConfig?.auth_config?.admin_password?.from_env;
		const authChanged = showPasswordSection
			? authConfig.is_enabled !== bifrostConfig?.auth_config?.is_enabled ||
				usernameChanged ||
				passwordChanged ||
				authConfig.disable_auth_on_inference !== bifrostConfig?.auth_config?.disable_auth_on_inference ||
				aoneOAuthChanged(authConfig.aone_oauth, bifrostConfig?.auth_config?.aone_oauth)
			: false;

		const localRequired = localConfig.required_headers?.slice().sort().join(",");
		const serverRequired = config.required_headers?.slice().sort().join(",");
		const requiredChanged = localRequired !== serverRequired;

		const localWhitelistedRoutes = localConfig.whitelisted_routes?.slice().sort().join(",");
		const serverWhitelistedRoutes = config.whitelisted_routes?.slice().sort().join(",");
		const whitelistedRoutesChanged = localWhitelistedRoutes !== serverWhitelistedRoutes;

		const enforceAuthOnInferenceChanged = localConfig.enforce_auth_on_inference !== config.enforce_auth_on_inference;

		return originsChanged || headersChanged || requiredChanged || whitelistedRoutesChanged || authChanged || enforceAuthOnInferenceChanged;
	}, [config, localConfig, authConfig, bifrostConfig, showPasswordSection]);

	const needsRestart = useMemo(() => {
		if (!config) return false;

		const localOrigins = localConfig.allowed_origins?.slice().sort().join(",");
		const serverOrigins = config.allowed_origins?.slice().sort().join(",");
		const originsChanged = localOrigins !== serverOrigins;

		const localHeaders = localConfig.allowed_headers?.slice().sort().join(",");
		const serverHeaders = config.allowed_headers?.slice().sort().join(",");
		const headersChanged = localHeaders !== serverHeaders;

		const enforceAuthOnInferenceChanged = localConfig.enforce_auth_on_inference !== config.enforce_auth_on_inference && IS_ENTERPRISE;

		return originsChanged || headersChanged || enforceAuthOnInferenceChanged;
	}, [config, localConfig]);

	const handleAllowedOriginsChange = useCallback((value: string) => {
		setLocalValues((prev) => ({ ...prev, allowed_origins: value }));
		setLocalConfig((prev) => ({ ...prev, allowed_origins: parseArrayFromText(value) }));
	}, []);

	const handleAllowedHeadersChange = useCallback((value: string) => {
		setLocalValues((prev) => ({ ...prev, allowed_headers: value }));
		setLocalConfig((prev) => ({ ...prev, allowed_headers: parseArrayFromText(value) }));
	}, []);

	const handleRequiredHeadersChange = useCallback((value: string) => {
		setLocalValues((prev) => ({ ...prev, required_headers: value }));
		setLocalConfig((prev) => ({ ...prev, required_headers: parseArrayFromText(value) }));
	}, []);

	const handleWhitelistedRoutesChange = useCallback((value: string) => {
		setLocalValues((prev) => ({ ...prev, whitelisted_routes: value }));
		setLocalConfig((prev) => ({ ...prev, whitelisted_routes: parseArrayFromText(value) }));
	}, []);

	const handleConfigChange = useCallback((field: keyof CoreConfig, value: boolean) => {
		setLocalConfig((prev) => ({ ...prev, [field]: value }));
	}, []);

	const handleAuthToggle = useCallback((checked: boolean) => {
		setAuthConfig((prev) => ({ ...prev, is_enabled: checked }));
	}, []);

	const handleDisableAuthOnInferenceToggle = useCallback((checked: boolean) => {
		setAuthConfig((prev) => ({ ...prev, disable_auth_on_inference: checked }));
	}, []);

	const handleAuthFieldChange = useCallback((field: "admin_username" | "admin_password", value: EnvVar) => {
		setAuthConfig((prev) => ({ ...prev, [field]: value }));
	}, []);

	const handleAoneOAuthToggle = useCallback((checked: boolean) => {
		setAuthConfig((prev) => ({
			...prev,
			aone_oauth: {
				...(prev.aone_oauth ?? defaultAoneOAuth()),
				enabled: checked,
			},
		}));
	}, []);

	const handleAoneOAuthFieldChange = useCallback((field: keyof AoneOAuthConfig, value: EnvVar | boolean) => {
		setAuthConfig((prev) => ({
			...prev,
			aone_oauth: {
				...(prev.aone_oauth ?? defaultAoneOAuth()),
				[field]: value,
			},
		}));
	}, []);

	const handleSave = useCallback(async () => {
		try {
			const validation = validateOrigins(localConfig.allowed_origins);

			if (!validation.isValid && localConfig.allowed_origins.length > 0) {
				toast.error(
					t("configViews.security.invalidOrigins", {
						invalidOrigins: validation.invalidOrigins.join(", "),
					}),
				);
				return;
			}
			const hasUsername = authConfig.admin_username?.value || authConfig.admin_username?.env_var;
			const hasPassword = authConfig.admin_password?.value || authConfig.admin_password?.env_var;
			await updateCoreConfig({
				...bifrostConfig!,
				client_config: localConfig,
				...(showPasswordSection
					? {
							auth_config: authConfig.is_enabled && hasUsername && hasPassword ? authConfig : { ...authConfig, is_enabled: false },
						}
					: {}),
			}).unwrap();
			toast.success(t("configViews.security.updated"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	}, [bifrostConfig, localConfig, authConfig, showPasswordSection, updateCoreConfig, t]);

	return (
		<div className="mx-auto w-full max-w-4xl space-y-4">
			<div>
				<h2 className="text-lg font-semibold tracking-tight">{pageTitle}</h2>
				<p className="text-muted-foreground text-sm">{pageDescription}</p>
			</div>

			<div className="space-y-4">
				{authConfig.is_enabled && !authConfig.disable_auth_on_inference && (
					<Alert variant="default" className="border-blue-20">
						<Info className="h-4 w-4 text-blue-600" />
						<AlertDescription>
							{t("configViews.security.basicAuthRequired")}{" "}
							<Link to="/workspace/config/api-keys" className="text-md text-primary underline">
								{t("configViews.shared.apiKeys")}
							</Link>
						</AlertDescription>
					</Alert>
				)}
				{authConfig.is_enabled && (authConfig.disable_auth_on_inference ?? true) && (
					<Alert variant="default" className="border-blue-20">
						<Info className="h-4 w-4 text-blue-600" />
						<AlertDescription>{t("configViews.security.authDisabledForInference")}</AlertDescription>
					</Alert>
				)}
				{/* Password Protect the Dashboard */}
				{IS_ENTERPRISE && authTypeLoading ? (
					<div className="flex items-center justify-center rounded-lg border p-8" data-testid="security-auth-type-loading">
						<Loader2 className="text-muted-foreground h-5 w-5 animate-spin" aria-hidden />
						<span className="sr-only">{t("configPages.loadingAuthSettings")}</span>
					</div>
				) : null}
				{IS_ENTERPRISE && !authTypeLoading && authTypeError ? (
					<Alert variant="destructive" data-testid="security-auth-type-error">
						<AlertTriangle className="h-4 w-4" />
						<AlertDescription>
							{t("configViews.security.authTypeLoadFailed")} {getErrorMessage(authTypeError)}
						</AlertDescription>
					</Alert>
				) : null}
				{showPasswordSection && (
					<div>
						<div className="space-y-4 rounded-lg border p-4">
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="auth-enabled" className="text-sm font-medium">
										{t("configViews.security.passwordProtectDashboard")} <Badge variant="secondary">{t("configViews.shared.beta")}</Badge>
									</Label>
									<p className="text-muted-foreground text-sm">{t("configViews.security.passwordProtectDesc")}</p>
								</div>
								<Switch id="auth-enabled" checked={authConfig.is_enabled} onCheckedChange={handleAuthToggle} />
							</div>
							<div className="space-y-4">
								<div className="space-y-2">
									<Label htmlFor="admin-username">{t("configViews.security.username")}</Label>
									<EnvVarInput
										id="admin-username"
										type="text"
										placeholder={t("configViews.security.usernamePlaceholder")}
										value={authConfig.admin_username}
										disabled={!authConfig.is_enabled}
										onChange={(value) => handleAuthFieldChange("admin_username", value)}
									/>
								</div>
								<div className="space-y-2">
									<Label htmlFor="admin-password">{t("configViews.security.password")}</Label>
									<EnvVarInput
										id="admin-password"
										type="password"
										placeholder={t("configViews.security.passwordPlaceholder")}
										value={authConfig.admin_password}
										disabled={!authConfig.is_enabled}
										onChange={(value) => handleAuthFieldChange("admin_password", value)}
									/>
								</div>
								{authConfig.is_enabled && (
									<div className="flex items-center justify-between">
										<div className="space-y-0.5">
											<Label htmlFor="disable-auth-inference" className="text-sm font-medium">
												{t("configViews.security.disableAuthOnInference")}{" "}
												<Badge variant="secondary">{t("configViews.shared.deprecatingSoon")}</Badge>
											</Label>
											<p className="text-muted-foreground text-sm">{t("configViews.security.disableAuthOnInferenceDesc")}</p>
										</div>
										<Switch
											id="disable-auth-inference"
											className="ml-5"
											checked={authConfig.disable_auth_on_inference ?? true}
											disabled={!authConfig.is_enabled}
											onCheckedChange={handleDisableAuthOnInferenceToggle}
										/>
									</div>
								)}
							</div>
						</div>
					</div>
				)}
				{showPasswordSection && (
					<div>
						<div className="space-y-4 rounded-lg border p-4">
							<div className="flex items-center justify-between">
								<div className="space-y-0.5">
									<Label htmlFor="aone-oauth-enabled" className="text-sm font-medium">
										{t("configViews.security.aoneOAuthLogin")}
									</Label>
									<p className="text-muted-foreground text-sm">{t("configViews.security.aoneOAuthDesc")}</p>
								</div>
								<Switch
									id="aone-oauth-enabled"
									checked={authConfig.aone_oauth?.enabled ?? false}
									disabled={!authConfig.is_enabled}
									onCheckedChange={handleAoneOAuthToggle}
								/>
							</div>
							{authConfig.aone_oauth?.enabled && (
								<div className="space-y-4">
									<div className="space-y-2">
										<Label htmlFor="aone-base-url">{t("configViews.security.baseUrl")}</Label>
										<EnvVarInput
											id="aone-base-url"
											type="text"
											placeholder={t("configViews.security.aoneBaseUrlPlaceholder")}
											value={authConfig.aone_oauth.base_url}
											disabled={!authConfig.is_enabled}
											onChange={(value) => handleAoneOAuthFieldChange("base_url", value)}
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="aone-client-id">{t("configViews.security.clientId")}</Label>
										<EnvVarInput
											id="aone-client-id"
											type="text"
											placeholder={t("configViews.security.aoneClientIdPlaceholder")}
											value={authConfig.aone_oauth.client_id}
											disabled={!authConfig.is_enabled}
											onChange={(value) => handleAoneOAuthFieldChange("client_id", value)}
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="aone-client-secret">{t("configViews.security.clientSecret")}</Label>
										<EnvVarInput
											id="aone-client-secret"
											type="password"
											placeholder={t("configViews.security.aoneClientSecretPlaceholder")}
											value={authConfig.aone_oauth.client_secret}
											disabled={!authConfig.is_enabled}
											onChange={(value) => handleAoneOAuthFieldChange("client_secret", value)}
										/>
									</div>
									<div className="space-y-2">
										<Label htmlFor="aone-redirect-uri">{t("configViews.security.redirectUri")}</Label>
										<EnvVarInput
											id="aone-redirect-uri"
											type="text"
											placeholder={t("configViews.security.aoneRedirectUriPlaceholder")}
											value={authConfig.aone_oauth.redirect_uri}
											disabled={!authConfig.is_enabled}
											onChange={(value) => handleAoneOAuthFieldChange("redirect_uri", value)}
										/>
									</div>
								</div>
							)}
						</div>
					</div>
				)}
				{/* Enable Auth on Inference */}
				<div className="flex items-center justify-between space-x-2 rounded-lg border p-4">
					<div className="space-y-0.5">
						<label htmlFor="enforce-auth-on-inference" className="text-sm font-medium">
							{IS_ENTERPRISE ? t("configViews.security.enableAuthOnInference") : t("configViews.security.enforceUsersOnInference")}
						</label>
						<p className="text-muted-foreground text-sm">
							{IS_ENTERPRISE ? t("configViews.security.enableAuthOnInferenceDesc") : t("configViews.security.enforceUsersOnInferenceDesc")}{" "}
							{t("configViews.shared.see")}{" "}
							<a
								href="https://docs.getbifrost.ai/features/governance/virtual-keys"
								target="_blank"
								rel="noopener noreferrer"
								className="text-primary underline"
								data-testid="security-virtual-keys-docs-link"
							>
								{t("configViews.shared.documentation")}
							</a>{" "}
							{t("configViews.shared.forDetails")}
						</p>
					</div>
					<Switch
						id="enforce-auth-on-inference"
						data-testid="enforce-auth-on-inference-switch"
						checked={localConfig.enforce_auth_on_inference}
						onCheckedChange={(checked) => handleConfigChange("enforce_auth_on_inference", checked)}
					/>
				</div>
				{/* Allowed Origins */}
				{needsRestart && <RestartWarning />}
				<div>
					<div className="space-y-2 rounded-lg border p-4">
						<div className="space-y-0.5">
							<label htmlFor="allowed-origins" className="text-sm font-medium">
								{t("configViews.security.allowedOrigins")}
							</label>
							<p className="text-muted-foreground text-sm">{t("configViews.security.allowedOriginsDesc")}</p>
						</div>
						<Textarea
							id="allowed-origins"
							className="h-24"
							placeholder={t("configViews.security.allowedOriginsPlaceholder")}
							value={localValues.allowed_origins}
							onChange={(e) => handleAllowedOriginsChange(e.target.value)}
						/>
					</div>
				</div>
				{/* Allowed Headers */}
				<div>
					<div className="space-y-2 rounded-lg border p-4">
						<div className="space-y-0.5">
							<label htmlFor="allowed-headers" className="text-sm font-medium">
								{t("configViews.security.allowedHeaders")}
							</label>
							<p className="text-muted-foreground text-sm">{t("configViews.security.allowedHeadersDesc")}</p>
						</div>
						<Textarea
							id="allowed-headers"
							className="h-24"
							placeholder={t("configViews.security.allowedHeadersPlaceholder")}
							value={localValues.allowed_headers}
							onChange={(e) => handleAllowedHeadersChange(e.target.value)}
						/>
					</div>
				</div>
				{/* Required Headers */}
				<div>
					<div className="space-y-2 rounded-lg border p-4">
						<div className="space-y-0.5">
							<label htmlFor="required-headers" className="text-sm font-medium">
								{t("configViews.security.requiredHeaders")}
							</label>
							<p className="text-muted-foreground text-sm">{t("configViews.security.requiredHeadersDesc")}</p>
						</div>
						<Textarea
							id="required-headers"
							data-testid="required-headers-textarea"
							className="h-24"
							placeholder={t("configViews.security.requiredHeadersPlaceholder")}
							value={localValues.required_headers}
							onChange={(e) => handleRequiredHeadersChange(e.target.value)}
						/>
					</div>
				</div>
				{/* Whitelisted Routes */}
				<div>
					<div className="space-y-2 rounded-lg border p-4">
						<div className="space-y-0.5">
							<label htmlFor="whitelisted-routes" className="text-sm font-medium">
								{t("configViews.security.whitelistedRoutes")}
							</label>
							<p className="text-muted-foreground text-sm">{t("configViews.security.whitelistedRoutesDesc")}</p>
						</div>
						<Textarea
							id="whitelisted-routes"
							data-testid="whitelisted-routes-textarea"
							className="h-24"
							placeholder={t("configViews.security.whitelistedRoutesPlaceholder")}
							value={localValues.whitelisted_routes}
							onChange={(e) => handleWhitelistedRoutesChange(e.target.value)}
						/>
					</div>
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
	return (
		<Alert variant="destructive" className="mt-2">
			<AlertTriangle className="h-4 w-4" />
			<AlertDescription>{t("configCommon.restartHint")}</AlertDescription>
		</Alert>
	);
};

function aoneOAuthChanged(current?: AoneOAuthConfig, previous?: AoneOAuthConfig) {
	const left = current ?? {
		enabled: false,
		base_url: { value: "", env_var: "", from_env: false },
		client_id: { value: "", env_var: "", from_env: false },
		client_secret: { value: "", env_var: "", from_env: false },
		redirect_uri: { value: "", env_var: "", from_env: false },
	};
	const right = previous ?? {
		enabled: false,
		base_url: { value: "", env_var: "", from_env: false },
		client_id: { value: "", env_var: "", from_env: false },
		client_secret: { value: "", env_var: "", from_env: false },
		redirect_uri: { value: "", env_var: "", from_env: false },
	};
	return (
		left.enabled !== right.enabled ||
		envVarChanged(left.base_url, right.base_url) ||
		envVarChanged(left.client_id, right.client_id) ||
		envVarChanged(left.client_secret, right.client_secret) ||
		envVarChanged(left.redirect_uri, right.redirect_uri)
	);
}

function envVarChanged(current: EnvVar, previous: EnvVar) {
	return current.value !== previous.value || current.env_var !== previous.env_var || current.from_env !== previous.from_env;
}
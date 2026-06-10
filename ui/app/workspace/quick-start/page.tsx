import { ModelCurlExampleCard } from "@/app/workspace/quick-start/views/modelCurlExampleCard";
import { CcSwitchImportCard } from "@/app/workspace/quick-start/views/ccSwitchImportCard";
import { ProviderIntegrationCard } from "@/app/workspace/quick-start/views/providerIntegrationCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiKeySelect } from "@/app/workspace/quick-start/views/apiKeySelect";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHeader from "@/components/ui/gradientHeader";
import { useIsLocalAdminSession } from "@/hooks/useIsLocalAdminSession";
import { useT } from "@/lib/i18n";
import { useGetGlobalApiKeyAccessQuery, useGetGlobalApiKeyTokenQuery, useGetProvidersQuery } from "@/lib/store";
import {
	buildCcSwitchImportUrl,
	buildClaudeCodeSettingsJson,
	buildCodexConfigToml,
	buildGeminiCliEnvScript,
	formatCodexModel,
	getProviderIntegrationGuide,
} from "@/lib/utils/providerIntegration";
import {
	isFullGlobalApiKeyToken,
	setStoredGlobalApiKey,
	setStoredGlobalApiKeySelectedId,
} from "@/lib/utils/globalApiKeyStorage";
import { pickQuickStartGlobalApiKey, resolveQuickStartApiKeyToken } from "@/lib/utils/resolveQuickStartApiKey";
import { getExampleBaseUrl } from "@/lib/utils/port";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Diamond, Rocket, SquareCode, Terminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

function resolveProviderGuide(
	configuredProviders: { name: string }[],
	preferredProvider: string,
	fallbackProvider: string,
	apiKey: string,
) {
	const preferred = configuredProviders.find((provider) => provider.name === preferredProvider);
	if (preferred) {
		return getProviderIntegrationGuide(preferred.name, apiKey);
	}
	if (configuredProviders.length > 0) {
		return getProviderIntegrationGuide(configuredProviders[0].name, apiKey);
	}
	return getProviderIntegrationGuide(fallbackProvider, apiKey);
}

export default function QuickStartView() {
	const t = useT();
	const isLocalAdmin = useIsLocalAdminSession();
	const { data: providers = [], isLoading: isLoadingProviders } = useGetProvidersQuery();
	const { data: accessData, isLoading: isLoadingAccess } = useGetGlobalApiKeyAccessQuery(undefined, {
		refetchOnMountOrArgChange: true,
	});

	const baseUrl = getExampleBaseUrl();
	const configuredProviders = useMemo(() => providers.slice().sort((a, b) => a.name.localeCompare(b.name)), [providers]);
	const hasAccess = accessData?.has_access === true;
	const assignedApiKeys = accessData?.api_keys ?? [];

	const [userSelectedKeyId, setUserSelectedKeyId] = useState<string | null>(null);

	useEffect(() => {
		if (assignedApiKeys.length === 0 || userSelectedKeyId !== null) {
			return;
		}
		setUserSelectedKeyId(assignedApiKeys[0].id);
	}, [assignedApiKeys, userSelectedKeyId]);

	useEffect(() => {
		for (const key of assignedApiKeys) {
			if (isFullGlobalApiKeyToken(key.token)) {
				setStoredGlobalApiKey(key.token, key.id);
			}
		}
	}, [assignedApiKeys]);

	const selectedKey = useMemo(
		() => pickQuickStartGlobalApiKey(assignedApiKeys, userSelectedKeyId),
		[assignedApiKeys, userSelectedKeyId],
	);
	const selectedKeyId = selectedKey?.id ?? "";

	const { data: fetchedTokenData, isFetching: isFetchingToken } = useGetGlobalApiKeyTokenQuery(selectedKeyId, {
		skip: !selectedKeyId,
		refetchOnMountOrArgChange: true,
	});

	const apiKey = useMemo(
		() => resolveQuickStartApiKeyToken(selectedKey, fetchedTokenData?.token),
		[fetchedTokenData?.token, selectedKey],
	);

	const isResolvingApiKey = !isFullGlobalApiKeyToken(apiKey) && isFetchingToken;
	const usingPlaceholderKey = !isFullGlobalApiKeyToken(apiKey) && !isResolvingApiKey;

	useEffect(() => {
		if (!isFullGlobalApiKeyToken(apiKey) || !selectedKeyId) {
			return;
		}
		setStoredGlobalApiKey(apiKey, selectedKeyId);
	}, [apiKey, selectedKeyId]);

	useEffect(() => {
		if (!selectedKeyId) {
			return;
		}
		setStoredGlobalApiKeySelectedId(selectedKeyId);
	}, [selectedKeyId]);

	const handleApiKeySelect = (keyId: string) => {
		setUserSelectedKeyId(keyId);
		setStoredGlobalApiKeySelectedId(keyId);
	};

	const anthropicGuide = useMemo(
		() => resolveProviderGuide(configuredProviders, "anthropic", "anthropic", apiKey),
		[configuredProviders, apiKey],
	);

	const geminiGuide = useMemo(() => resolveProviderGuide(configuredProviders, "gemini", "gemini", apiKey), [configuredProviders, apiKey]);

	const openaiGuide = useMemo(() => resolveProviderGuide(configuredProviders, "openai", "openai", apiKey), [configuredProviders, apiKey]);

	const codexModel = useMemo(() => formatCodexModel(openaiGuide.exampleModel), [openaiGuide.exampleModel]);

	const claudeCcSwitchUrl = useMemo(
		() =>
			buildCcSwitchImportUrl({
				app: "claude",
				name: "Bifrost",
				endpoint: `${baseUrl}/anthropic`,
				apiKey,
				sonnetModel: anthropicGuide.exampleModel.includes("/") ? anthropicGuide.exampleModel : `anthropic/${anthropicGuide.exampleModel}`,
				haikuModel: anthropicGuide.exampleModel.includes("/") ? anthropicGuide.exampleModel : `anthropic/${anthropicGuide.exampleModel}`,
			}),
		[anthropicGuide.exampleModel, apiKey, baseUrl],
	);

	const geminiCcSwitchUrl = useMemo(
		() =>
			buildCcSwitchImportUrl({
				app: "gemini",
				name: "Bifrost",
				endpoint: `${baseUrl}/genai`,
				apiKey,
				model: geminiGuide.exampleModel,
			}),
		[apiKey, baseUrl, geminiGuide.exampleModel],
	);

	const codexCcSwitchUrl = useMemo(
		() =>
			buildCcSwitchImportUrl({
				app: "codex",
				name: "Bifrost",
				endpoint: `${baseUrl}/openai/v1`,
				apiKey,
				model: codexModel,
			}),
		[apiKey, baseUrl, codexModel],
	);

	const claudeSettingsJson = useMemo(() => buildClaudeCodeSettingsJson(baseUrl, apiKey), [apiKey, baseUrl]);
	const geminiEnvScript = useMemo(() => buildGeminiCliEnvScript(baseUrl, apiKey), [apiKey, baseUrl]);
	const codexConfigToml = useMemo(() => buildCodexConfigToml(baseUrl, apiKey, codexModel), [apiKey, baseUrl, codexModel]);

	if (isLoadingAccess) {
		return (
			<div className="flex flex-col gap-6 p-6">
				<GradientHeader title={t("quickStart.title")} />
				<p className="text-muted-foreground text-sm">{t("quickStart.loadingAccess")}</p>
			</div>
		);
	}

	if (!hasAccess) {
		return (
			<div className="flex flex-col gap-6 p-6">
				<GradientHeader title={t("quickStart.title")} />
				<Alert data-testid="quick-start-no-access-alert">
					<AlertCircle className="size-4" />
					<AlertDescription>{t("quickStart.noGlobalApiKeyAccess")}</AlertDescription>
				</Alert>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6 p-6">
			<div>
				<GradientHeader title={t("quickStart.title")} />
				<p className="text-muted-foreground mt-2 max-w-3xl text-sm">{t("quickStart.subtitle")}</p>
			</div>

			<Card data-testid="quick-start-model-requests-card">
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<Rocket className="size-5" />
						{t("quickStart.modelRequests")}
					</CardTitle>
					<CardDescription>{t("quickStart.modelRequestsDesc")}</CardDescription>
				</CardHeader>
				<CardContent className="space-y-4">
					<ApiKeySelect apiKeys={assignedApiKeys} selectedKeyId={selectedKeyId} onSelect={handleApiKeySelect} />
					{isResolvingApiKey ? (
						<p className="text-muted-foreground text-sm" data-testid="quick-start-api-key-loading">
							{t("quickStart.loadingApiKey")}
						</p>
					) : null}
					<ModelCurlExampleCard
						baseUrl={baseUrl}
						apiKey={apiKey}
						selectedKeyId={selectedKeyId}
						isApiKeyLoading={isResolvingApiKey}
					/>
				</CardContent>
			</Card>

			{isLocalAdmin ? (
				<>
					<div className="grid gap-4 xl:grid-cols-3">
						<CcSwitchImportCard
							title={t("quickStart.claudeCode.title")}
							icon={Terminal}
							description={t("quickStart.claudeCode.description")}
							testId="quick-start-cc-switch-claude"
							importUrl={claudeCcSwitchUrl}
							manualConfigLabel={t("quickStart.claudeCode.manualLabel")}
							manualConfig={claudeSettingsJson}
							manualConfigLanguage="json"
							showApiKeyWarning={usingPlaceholderKey}
							apiKeyWarning={t("quickStart.apiKeyWarningDefault")}
						/>
						<CcSwitchImportCard
							title={t("quickStart.geminiCli.title")}
							icon={Diamond}
							description={t("quickStart.geminiCli.description")}
							testId="quick-start-cc-switch-gemini"
							importUrl={geminiCcSwitchUrl}
							manualConfigLabel={t("quickStart.geminiCli.manualLabel")}
							manualConfig={geminiEnvScript}
							manualConfigLanguage="shell"
							showApiKeyWarning={usingPlaceholderKey}
							apiKeyWarning={t("quickStart.apiKeyWarningDefault")}
						/>
						<CcSwitchImportCard
							title={t("quickStart.codexCli.title")}
							icon={SquareCode}
							description={t("quickStart.codexCli.description")}
							testId="quick-start-cc-switch-codex"
							importUrl={codexCcSwitchUrl}
							manualConfigLabel={t("quickStart.codexCli.manualLabel")}
							manualConfig={codexConfigToml}
							manualConfigLanguage="shell"
							showApiKeyWarning={usingPlaceholderKey}
							apiKeyWarning={t("quickStart.apiKeyWarningDefault")}
						/>
					</div>

					<Card data-testid="quick-start-providers-card">
						<CardHeader>
							<CardTitle className="flex items-center gap-2">
								<Rocket className="size-5" />
								{t("quickStart.providerIntegration")}
							</CardTitle>
							<CardDescription>
								{t("quickStart.providerIntegrationDesc")} <code>{baseUrl}</code>
							</CardDescription>
						</CardHeader>
						<CardContent>
							{isLoadingProviders ? (
								<p className="text-muted-foreground text-sm">{t("quickStart.loadingProviders")}</p>
							) : configuredProviders.length === 0 ? (
								<Alert>
									<AlertCircle className="size-4" />
									<AlertDescription className="flex flex-wrap items-center gap-1">
										{t("quickStart.noProviders")}{" "}
										<Link to="/workspace/providers" className="text-primary underline-offset-4 hover:underline">
											{t("quickStart.modelProviders")}
										</Link>{" "}
										{t("quickStart.toAddOne")}
									</AlertDescription>
								</Alert>
							) : (
								<div className="grid gap-4">
									{configuredProviders.map((provider) => (
										<ProviderIntegrationCard key={provider.name} provider={provider.name} baseUrl={baseUrl} apiKey={apiKey} />
									))}
								</div>
							)}
						</CardContent>
					</Card>
				</>
			) : null}
		</div>
	);
}

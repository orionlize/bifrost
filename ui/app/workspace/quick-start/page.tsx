import { ProviderIntegrationCard } from "@/app/workspace/quick-start/views/providerIntegrationCard";
import { CcSwitchImportCard } from "@/app/workspace/quick-start/views/ccSwitchImportCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHeader from "@/components/ui/gradientHeader";
import { useAoneCurrentUser } from "@/hooks/useAoneCurrentUser";
import { IS_ENTERPRISE } from "@/lib/constants/config";
import { useT } from "@/lib/i18n";
import { useGetProvidersQuery, useIsAuthEnabledQuery } from "@/lib/store";
import { getAoneApiKey } from "@/lib/utils/aoneUserStorage";
import {
	buildCcSwitchImportUrl,
	buildClaudeCodeSettingsJson,
	buildCodexConfigToml,
	buildGeminiCliEnvScript,
	formatCodexModel,
	getProviderIntegrationGuide,
} from "@/lib/utils/providerIntegration";
import { getExampleBaseUrl } from "@/lib/utils/port";
import { Link } from "@tanstack/react-router";
import { AlertCircle, Diamond, Rocket, SquareCode, Terminal } from "lucide-react";
import { useMemo } from "react";

const PLACEHOLDER_API_KEY = "your-api-key";

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
	const { data: providers = [], isLoading } = useGetProvidersQuery();
	const { data: authStatus } = useIsAuthEnabledQuery();
	const { data: aoneUser } = useAoneCurrentUser();

	const baseUrl = getExampleBaseUrl();
	const configuredProviders = useMemo(() => providers.slice().sort((a, b) => a.name.localeCompare(b.name)), [providers]);

	const apiKey = useMemo(() => {
		const cachedKey = getAoneApiKey();
		if (cachedKey) {
			return cachedKey;
		}
		if (aoneUser?.api_key) {
			return aoneUser.api_key;
		}
		return PLACEHOLDER_API_KEY;
	}, [aoneUser?.api_key]);

	const isAoneAuth = !IS_ENTERPRISE && (authStatus?.aone_oauth_enabled ?? false);
	const usingPlaceholderKey = apiKey === PLACEHOLDER_API_KEY;
	const apiKeyWarning = isAoneAuth ? t("quickStart.apiKeyWarningAone") : t("quickStart.apiKeyWarningDefault");

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

	return (
		<div className="flex flex-col gap-6 p-6">
			<div>
				<GradientHeader title={t("quickStart.title")} />
				<p className="text-muted-foreground mt-2 max-w-3xl text-sm">{t("quickStart.subtitle")}</p>
			</div>

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
					apiKeyWarning={apiKeyWarning}
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
					apiKeyWarning={apiKeyWarning}
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
					apiKeyWarning={apiKeyWarning}
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
					{isLoading ? (
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
		</div>
	);
}

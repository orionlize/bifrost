import { ProviderIntegrationCard } from "@/app/workspace/quick-start/views/providerIntegrationCard";
import { CcSwitchImportCard } from "@/app/workspace/quick-start/views/ccSwitchImportCard";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import GradientHeader from "@/components/ui/gradientHeader";
import { useAoneCurrentUser } from "@/hooks/useAoneCurrentUser";
import { IS_ENTERPRISE } from "@/lib/constants/config";
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
	const apiKeyWarning = isAoneAuth
		? "No personal API key found. Sign in with your Aone account before importing."
		: "Replace your-api-key in the examples with your Virtual Key or API key.";

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
				<GradientHeader title="Quick Start" />
				<p className="text-muted-foreground mt-2 max-w-3xl text-sm">
					Manual integration examples for your configured providers, or one-click Claude Code, Codex CLI, and Gemini CLI setup via CC
					Switch.
				</p>
			</div>

			<div className="grid gap-4 xl:grid-cols-3">
				<CcSwitchImportCard
					title="Claude Code · CC Switch"
					icon={Terminal}
					description="Import your Bifrost gateway into Claude Code with the CC Switch desktop app. Install"
					testId="quick-start-cc-switch-claude"
					importUrl={claudeCcSwitchUrl}
					manualConfigLabel="Manual setup for ~/.claude/settings.json (merge into your existing config):"
					manualConfig={claudeSettingsJson}
					manualConfigLanguage="json"
					showApiKeyWarning={usingPlaceholderKey}
					apiKeyWarning={apiKeyWarning}
				/>
				<CcSwitchImportCard
					title="Gemini CLI · CC Switch"
					icon={Diamond}
					description="Import your Bifrost gateway into Gemini CLI with the CC Switch desktop app. Install"
					testId="quick-start-cc-switch-gemini"
					importUrl={geminiCcSwitchUrl}
					manualConfigLabel="Manual setup (add to your shell profile or run before gemini):"
					manualConfig={geminiEnvScript}
					manualConfigLanguage="shell"
					showApiKeyWarning={usingPlaceholderKey}
					apiKeyWarning={apiKeyWarning}
				/>
				<CcSwitchImportCard
					title="Codex CLI · CC Switch"
					icon={SquareCode}
					description="Import your Bifrost gateway into OpenAI Codex CLI with the CC Switch desktop app. Install"
					testId="quick-start-cc-switch-codex"
					importUrl={codexCcSwitchUrl}
					manualConfigLabel="Manual setup for ~/.codex/config.toml (merge into your existing config):"
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
						Provider Integration
					</CardTitle>
					<CardDescription>
						Examples below use your currently configured providers. Gateway URL: <code>{baseUrl}</code>
					</CardDescription>
				</CardHeader>
				<CardContent>
					{isLoading ? (
						<p className="text-muted-foreground text-sm">Loading provider configuration...</p>
					) : configuredProviders.length === 0 ? (
						<Alert>
							<AlertCircle className="size-4" />
							<AlertDescription className="flex flex-wrap items-center gap-1">
								No providers configured yet. Go to{" "}
								<Link to="/workspace/providers" className="text-primary underline-offset-4 hover:underline">
									Model Providers
								</Link>{" "}
								to add one.
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
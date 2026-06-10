import { ModelPlaceholders } from "@/lib/constants/config";
import { ProviderName } from "@/lib/constants/logs";
import { isKnownProvider } from "@/lib/types/config";

export type IntegrationSdkKind = "openai" | "anthropic" | "genai";

export interface ProviderIntegrationGuide {
	pathPrefix: string;
	sdkKind: IntegrationSdkKind;
	exampleModel: string;
	authHeader: string;
}

const DEFAULT_EXAMPLE_MODEL = "gpt-4o-mini";

function firstModelFromPlaceholder(placeholder: string): string {
	const match = placeholder.match(/e\.g\.\s*([^,\.]+)/i);
	return match?.[1]?.trim() || DEFAULT_EXAMPLE_MODEL;
}

function getExampleModel(provider: string): string {
	if (isKnownProvider(provider)) {
		const placeholder = ModelPlaceholders[provider as ProviderName];
		if (placeholder) {
			return firstModelFromPlaceholder(placeholder);
		}
	}
	return DEFAULT_EXAMPLE_MODEL;
}

function getSdkKind(provider: string): IntegrationSdkKind {
	switch (provider) {
		case "anthropic":
			return "anthropic";
		case "gemini":
		case "vertex":
			return "genai";
		default:
			return "openai";
	}
}

function getPathPrefix(sdkKind: IntegrationSdkKind): string {
	switch (sdkKind) {
		case "anthropic":
			return "/anthropic";
		case "genai":
			return "/genai";
		default:
			return "/openai";
	}
}

function getModelForProvider(provider: string, sdkKind: IntegrationSdkKind, exampleModel: string): string {
	if (sdkKind === "anthropic") {
		return exampleModel;
	}
	if (sdkKind === "genai") {
		return provider === "vertex" ? `vertex/${exampleModel}` : exampleModel;
	}
	if (provider === "openai") {
		return exampleModel;
	}
	return `${provider}/${exampleModel}`;
}

export function getProviderIntegrationGuide(provider: string, apiKey: string): ProviderIntegrationGuide {
	const sdkKind = getSdkKind(provider);
	const exampleModel = getExampleModel(provider);
	const model = getModelForProvider(provider, sdkKind, exampleModel);

	return {
		pathPrefix: getPathPrefix(sdkKind),
		sdkKind,
		exampleModel: model,
		authHeader: `Authorization: Bearer ${apiKey}`,
	};
}

export function getModelIntegrationGuide(model: string, provider: string, apiKey: string): ProviderIntegrationGuide {
	const sdkKind = getSdkKind(provider);
	const resolvedModel = getModelForProvider(provider, sdkKind, model);

	return {
		pathPrefix: getPathPrefix(sdkKind),
		sdkKind,
		exampleModel: resolvedModel,
		authHeader: `Authorization: Bearer ${apiKey}`,
	};
}

export function buildCurlExample(baseUrl: string, guide: ProviderIntegrationGuide): string {
	const endpoint =
		guide.sdkKind === "anthropic"
			? `${baseUrl}${guide.pathPrefix}/v1/messages`
			: guide.sdkKind === "genai"
				? `${baseUrl}${guide.pathPrefix}/v1beta/models/${guide.exampleModel}:generateContent`
				: `${baseUrl}${guide.pathPrefix}/v1/chat/completions`;

	if (guide.sdkKind === "anthropic") {
		return `curl -X POST ${endpoint} \\
  -H "Content-Type: application/json" \\
  -H "${guide.authHeader}" \\
  -d '{
    "model": "${guide.exampleModel}",
    "max_tokens": 1024,
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
	}

	if (guide.sdkKind === "genai") {
		return `curl -X POST ${endpoint} \\
  -H "Content-Type: application/json" \\
  -H "${guide.authHeader}" \\
  -d '{
    "contents": [{"role": "user", "parts": [{"text": "Hello!"}]}]
  }'`;
	}

	return `curl -X POST ${endpoint} \\
  -H "Content-Type: application/json" \\
  -H "${guide.authHeader}" \\
  -d '{
    "model": "${guide.exampleModel}",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'`;
}

export function buildOpenAiSdkExample(
	baseUrl: string,
	guide: ProviderIntegrationGuide,
	language: "python" | "typescript",
	apiKey: string,
): string {
	const basePath = `${baseUrl}${guide.pathPrefix}`;

	if (language === "python") {
		return `import openai

client = openai.OpenAI(
    base_url="${basePath}",
    api_key="${apiKey}",
)

response = client.chat.completions.create(
    model="${guide.exampleModel}",
    messages=[{"role": "user", "content": "Hello!"}],
)`;
	}

	return `import OpenAI from "openai";

const client = new OpenAI({
  baseURL: "${basePath}",
  apiKey: "${apiKey}",
});

const response = await client.chat.completions.create({
  model: "${guide.exampleModel}",
  messages: [{ role: "user", content: "Hello!" }],
});`;
}

export function buildAnthropicSdkExample(
	baseUrl: string,
	guide: ProviderIntegrationGuide,
	language: "python" | "typescript",
	apiKey: string,
): string {
	const basePath = `${baseUrl}${guide.pathPrefix}`;

	if (language === "python") {
		return `import anthropic

client = anthropic.Anthropic(
    base_url="${basePath}",
    api_key="${apiKey}",
)

response = client.messages.create(
    model="${guide.exampleModel}",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Hello!"}],
)`;
	}

	return `import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic({
  baseURL: "${basePath}",
  apiKey: "${apiKey}",
});

const response = await client.messages.create({
  model: "${guide.exampleModel}",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello!" }],
});`;
}

export function buildGenAiSdkExample(
	baseUrl: string,
	guide: ProviderIntegrationGuide,
	language: "python" | "typescript",
	apiKey: string,
): string {
	const basePath = `${baseUrl}${guide.pathPrefix}`;

	if (language === "python") {
		return `from google import genai
from google.genai.types import HttpOptions

client = genai.Client(
    api_key="${apiKey}",
    http_options=HttpOptions(base_url="${basePath}"),
)

response = client.models.generate_content(
    model="${guide.exampleModel}",
    contents="Hello!",
)`;
	}

	return `import { GoogleGenAI } from "@google/genai";

const client = new GoogleGenAI({
  apiKey: "${apiKey}",
  httpOptions: { baseUrl: "${basePath}" },
});

const response = await client.models.generateContent({
  model: "${guide.exampleModel}",
  contents: "Hello!",
});`;
}

export function buildSdkExample(
	baseUrl: string,
	guide: ProviderIntegrationGuide,
	language: "python" | "typescript",
	apiKey: string,
): string {
	switch (guide.sdkKind) {
		case "anthropic":
			return buildAnthropicSdkExample(baseUrl, guide, language, apiKey);
		case "genai":
			return buildGenAiSdkExample(baseUrl, guide, language, apiKey);
		default:
			return buildOpenAiSdkExample(baseUrl, guide, language, apiKey);
	}
}

export function buildClaudeCodeSettingsJson(baseUrl: string, apiKey: string): string {
	return JSON.stringify(
		{
			env: {
				ANTHROPIC_BASE_URL: `${baseUrl}/anthropic`,
				ANTHROPIC_AUTH_TOKEN: apiKey,
			},
		},
		null,
		2,
	);
}

export type CcSwitchApp = "claude" | "codex" | "gemini";

export function buildCcSwitchImportUrl(options: {
	app: CcSwitchApp;
	name: string;
	endpoint: string;
	apiKey: string;
	model?: string;
	sonnetModel?: string;
	haikuModel?: string;
}): string {
	const params = new URLSearchParams({
		resource: "provider",
		app: options.app,
		name: options.name,
		endpoint: options.endpoint,
		apiKey: options.apiKey,
		enabled: "true",
	});

	if (options.model) {
		params.set("model", options.model);
	}
	if (options.sonnetModel) {
		params.set("sonnetModel", options.sonnetModel);
	}
	if (options.haikuModel) {
		params.set("haikuModel", options.haikuModel);
	}

	return `ccswitch://v1/import?${params.toString()}`;
}

export function buildGeminiCliEnvScript(baseUrl: string, apiKey: string): string {
	return `export GEMINI_API_KEY=${apiKey}
export GOOGLE_GEMINI_BASE_URL=${baseUrl}/genai`;
}

export function buildCodexConfigToml(baseUrl: string, apiKey: string, model: string): string {
	return `# Add to ~/.codex/config.toml
# Run in the same terminal session:
# export OPENAI_API_KEY=${apiKey}

openai_base_url="${baseUrl}/openai/v1"
env_key="OPENAI_API_KEY"
model = "${model}"
`;
}

export function formatCodexModel(model: string): string {
	return model.includes("/") ? model : `openai/${model}`;
}
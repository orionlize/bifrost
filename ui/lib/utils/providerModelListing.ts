import { KnownProvidersNames } from "@/lib/constants/logs";

const NESTED_MODEL_PROVIDERS = new Set(["openrouter", "vertex", "groq", "bedrock", "replicate"]);

const DIRECT_PROVIDER_EXCLUSIVE_PREFIXES: Record<string, string[]> = {
	openai: ["gemini", "claude", "anthropic/", "google/", "mistral", "meta-llama", "llama-", "command-", "cohere/"],
	anthropic: ["gemini", "gpt-", "google/", "mistral", "meta-llama", "llama-", "command-", "text-embedding-3", "o1-", "o3-", "o4-"],
	gemini: ["gpt-", "claude", "anthropic/", "mistral", "meta-llama", "llama-", "command-"],
	mistral: ["gpt-", "gemini", "claude", "anthropic/", "google/"],
	cohere: ["gpt-", "gemini", "claude", "anthropic/", "google/"],
};

const KNOWN_PROVIDER_SLUGS = new Set<string>(KnownProvidersNames);

function leadingProviderSlug(model: string): string | null {
	const slash = model.indexOf("/");
	if (slash <= 0) return null;
	const prefix = model.slice(0, slash).toLowerCase();
	return KNOWN_PROVIDER_SLUGS.has(prefix) ? prefix : null;
}

function modelNameConflictsWithDirectProvider(provider: string, model: string): boolean {
	const prefixes = DIRECT_PROVIDER_EXCLUSIVE_PREFIXES[provider.toLowerCase()];
	if (!prefixes?.length) return false;
	const lower = model.toLowerCase();
	return prefixes.some((prefix) => lower.startsWith(prefix));
}

/** Mirrors framework/modelcatalog/listingfilter.go for defense-in-depth in the UI. */
export function shouldListModelUnderProvider(provider: string | undefined, modelName: string): boolean {
	const model = modelName.trim();
	if (!model) return false;
	if (!provider) return true;
	const normalized = provider.toLowerCase();
	if (NESTED_MODEL_PROVIDERS.has(normalized)) return true;

	const leading = leadingProviderSlug(model);
	if (leading) return leading === normalized;

	return !modelNameConflictsWithDirectProvider(normalized, model);
}

export interface ProviderScopedModel {
	name: string;
	provider: string;
}

export function filterModelsForProviderListing(models: ProviderScopedModel[] | undefined, provider?: string): ProviderScopedModel[] {
	if (!models?.length) return [];
	if (!provider) return models;
	const normalized = provider.toLowerCase();
	return models.filter((model) => model.provider.toLowerCase() === normalized && shouldListModelUnderProvider(provider, model.name));
}
import { ModelProvider } from "@/lib/types/config";
import { DBKey } from "@/lib/types/governance";

export interface ProviderModelPickerOptions {
	extraModels?: string[];
	allowCustomModels: boolean;
	unfiltered: boolean;
	keyIds?: string[];
	fetchBaseProviderCatalog: boolean;
	baseProviderType?: string;
}

/** Resolves model-picker props for provider-scoped dropdowns (routing targets, fallbacks, etc.). */
export function resolveProviderModelPickerOptions(
	provider: string | undefined,
	keyId: string | undefined,
	allKeys: DBKey[],
	providers: ModelProvider[],
): ProviderModelPickerOptions {
	if (!provider) {
		return {
			allowCustomModels: false,
			unfiltered: false,
			fetchBaseProviderCatalog: false,
		};
	}

	const providerConfig = providers.find((p) => p.name === provider);
	const isCustomProvider = !!providerConfig?.custom_provider_config;
	const baseProviderType = providerConfig?.custom_provider_config?.base_provider_type;
	const providerKeys = allKeys.filter((k) => k.provider === provider);
	const relevantKeys = keyId ? providerKeys.filter((k) => k.key_id === keyId) : providerKeys;

	const hasWildcardAllowlist = relevantKeys.some((k) => k.models?.includes("*"));
	const configuredModels = new Set<string>();
	for (const key of relevantKeys) {
		for (const model of key.models ?? []) {
			if (model && model !== "*") {
				configuredModels.add(model);
			}
		}
	}

	let keyIds: string[] | undefined;
	if (keyId) {
		keyIds = [keyId];
	} else if (!hasWildcardAllowlist && providerKeys.length > 0) {
		keyIds = providerKeys.map((k) => k.key_id);
	}

	const fetchBaseProviderCatalog = hasWildcardAllowlist && !!baseProviderType && baseProviderType !== provider;

	return {
		extraModels: configuredModels.size > 0 ? Array.from(configuredModels) : undefined,
		allowCustomModels: true,
		unfiltered: hasWildcardAllowlist || isCustomProvider,
		keyIds,
		fetchBaseProviderCatalog,
		baseProviderType: fetchBaseProviderCatalog ? baseProviderType : undefined,
	};
}

export interface QuickStartModelPickerOptions {
	keyIds?: string[];
	extraModels?: string[];
}

/** Resolves model-picker props for quick start across all configured provider keys. */
export function resolveQuickStartModelPickerOptions(allKeys: DBKey[]): QuickStartModelPickerOptions {
	if (allKeys.length === 0) {
		return {};
	}

	const configuredModels = new Set<string>();
	for (const key of allKeys) {
		for (const model of key.models ?? []) {
			if (model && model !== "*") {
				configuredModels.add(model);
			}
		}
	}

	return {
		keyIds: allKeys.map((key) => key.key_id),
		extraModels: configuredModels.size > 0 ? Array.from(configuredModels) : undefined,
	};
}
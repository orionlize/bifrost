import { useGetModelsQuery } from "@/lib/store/apis/providersApi";
import { ModelProvider } from "@/lib/types/config";
import { DBKey } from "@/lib/types/governance";
import { resolveProviderModelPickerOptions } from "@/lib/utils/providerModelPickerOptions";
import { useMemo } from "react";

export function useProviderModelPickerOptions(
	provider: string | undefined,
	keyId: string | undefined,
	allKeys: DBKey[],
	providers: ModelProvider[],
) {
	const resolved = useMemo(
		() => resolveProviderModelPickerOptions(provider, keyId, allKeys, providers),
		[provider, keyId, allKeys, providers],
	);

	const { data: baseCatalogData } = useGetModelsQuery(
		{ provider: resolved.baseProviderType, limit: 50, unfiltered: true },
		{ skip: !resolved.fetchBaseProviderCatalog || !resolved.baseProviderType },
	);

	const extraModels = useMemo(() => {
		const merged = new Set(resolved.extraModels ?? []);
		if (resolved.fetchBaseProviderCatalog) {
			for (const model of baseCatalogData?.models ?? []) {
				merged.add(model.name);
			}
		}
		return merged.size > 0 ? Array.from(merged) : undefined;
	}, [resolved.extraModels, resolved.fetchBaseProviderCatalog, baseCatalogData?.models]);

	return {
		extraModels,
		allowCustomModels: resolved.allowCustomModels,
		unfiltered: resolved.unfiltered,
		keyIds: resolved.keyIds,
	};
}

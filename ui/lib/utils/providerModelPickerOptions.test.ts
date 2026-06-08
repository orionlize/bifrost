import { describe, expect, it } from "vitest";
import { resolveProviderModelPickerOptions } from "./providerModelPickerOptions";
import { ModelProvider, ModelProviderName } from "@/lib/types/config";
import { DBKey } from "@/lib/types/governance";

const customProviderName = "acme-llm" as ModelProviderName;

const customProvider: ModelProvider = {
	name: customProviderName,
	provider_status: "active",
	custom_provider_config: {
		base_provider_type: "openai",
		is_key_less: false,
	},
};

const keys: DBKey[] = [
	{
		key_id: "key-a",
		name: "Primary",
		provider: customProviderName,
		provider_id: "1",
		models: ["custom-model-a", "custom-model-b"],
	},
];

describe("resolveProviderModelPickerOptions", () => {
	it("returns configured key models for a custom provider", () => {
		const result = resolveProviderModelPickerOptions(customProviderName, undefined, keys, [customProvider]);

		expect(result.extraModels).toEqual(["custom-model-a", "custom-model-b"]);
		expect(result.keyIds).toEqual(["key-a"]);
		expect(result.unfiltered).toBe(true);
		expect(result.fetchBaseProviderCatalog).toBe(false);
	});

	it("loads base provider catalog when allowlist is wildcard", () => {
		const wildcardKeys: DBKey[] = [{ ...keys[0], models: ["*"] }];
		const result = resolveProviderModelPickerOptions(customProviderName, "key-a", wildcardKeys, [customProvider]);

		expect(result.extraModels).toBeUndefined();
		expect(result.keyIds).toEqual(["key-a"]);
		expect(result.unfiltered).toBe(true);
		expect(result.fetchBaseProviderCatalog).toBe(true);
		expect(result.baseProviderType).toBe("openai");
	});

	it("scopes to a selected key when provided", () => {
		const multiKey: DBKey[] = [
			keys[0],
			{
				key_id: "key-b",
				name: "Secondary",
				provider: customProviderName,
				provider_id: "1",
				models: ["other-model"],
			},
		];
		const result = resolveProviderModelPickerOptions(customProviderName, "key-a", multiKey, [customProvider]);

		expect(result.extraModels).toEqual(["custom-model-a", "custom-model-b"]);
		expect(result.keyIds).toEqual(["key-a"]);
	});
});

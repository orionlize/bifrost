/**
 * CEL Rule Builder for Routing Rules
 * Thin wrapper around the reusable CELRuleBuilder with routing-specific config
 */

import { CELRuleBuilder as BaseCELRuleBuilder } from "@/components/ui/custom/celBuilder";
import { getRoutingFields } from "@/lib/config/celFieldsRouting";
import { celOperatorsRouting } from "@/lib/config/celOperatorsRouting";
import type { TranslateFn } from "@/lib/i18n";
import { useListGlobalApiKeysQuery } from "@/lib/store/apis/globalApiKeysApi";
import { convertRuleGroupToCEL, validateRegexPattern } from "@/lib/utils/celConverterRouting";
import { mergeGlobalApiKeyOptions, normalizeGlobalApiKeyIdsInQuery } from "@/lib/utils/globalApiKeyRoutingOptions";
import { useMemo } from "react";
import { RuleGroupType, RuleType } from "react-querybuilder";

interface CELRuleBuilderProps {
	onChange?: (celExpression: string, query: RuleGroupType) => void;
	initialQuery?: RuleGroupType;
	providers?: string[];
	models?: string[];
	allowCustomModels?: boolean;
	translate: TranslateFn;
}

function collectRuleFieldValues(query: RuleGroupType | undefined, fieldName: string): string[] {
	if (!query?.rules?.length) {
		return [];
	}

	const values = new Set<string>();

	const walk = (group: RuleGroupType) => {
		for (const rule of group.rules ?? []) {
			if ("combinator" in rule && "rules" in rule) {
				walk(rule as RuleGroupType);
				continue;
			}

			const typedRule = rule as RuleType;
			if (typedRule.field !== fieldName || typedRule.value == null || typedRule.value === "") {
				continue;
			}

			if (Array.isArray(typedRule.value)) {
				for (const item of typedRule.value) {
					const value = String(item).trim();
					if (value) {
						values.add(value);
					}
				}
				continue;
			}

			if (typeof typedRule.value === "string") {
				const raw = typedRule.value.trim();
				if (!raw) {
					continue;
				}
				if (raw.startsWith("[")) {
					try {
						const parsed = JSON.parse(raw);
						if (Array.isArray(parsed)) {
							for (const item of parsed) {
								const value = String(item).trim();
								if (value) {
									values.add(value);
								}
							}
							continue;
						}
					} catch {
						// fall through to treat as plain string
					}
				}
				values.add(raw);
			}
		}
	};

	walk(query);
	return Array.from(values);
}

export function CELRuleBuilder({
	onChange,
	initialQuery,
	providers = [],
	models = [],
	allowCustomModels = false,
	translate,
}: CELRuleBuilderProps) {
	const { data: globalApiKeysData, isLoading: isLoadingGlobalApiKeys } = useListGlobalApiKeysQuery();

	const globalApiKeyOptions = useMemo(() => {
		const fromApi = (globalApiKeysData?.api_keys ?? []).map((key) => ({
			id: key.id,
			name: key.name,
		}));
		const referencedValues = collectRuleFieldValues(initialQuery, "global_api_key_id");
		return mergeGlobalApiKeyOptions(fromApi, referencedValues);
	}, [globalApiKeysData, initialQuery]);

	const normalizedInitialQuery = useMemo(
		() => normalizeGlobalApiKeyIdsInQuery(initialQuery, globalApiKeyOptions) ?? initialQuery,
		[initialQuery, globalApiKeyOptions],
	);

	const fields = useMemo(() => {
		const baseFields = getRoutingFields(providers, models, globalApiKeyOptions);
		return baseFields.map((field) => {
			if (field.name === "global_api_key_id") {
				return {
					...field,
					label: translate("routing.celBuilder.adminApiKey"),
					description: translate("routing.celBuilder.adminApiKeyHint"),
					placeholder: translate("routing.celBuilder.selectAdminApiKey"),
				};
			}
			return field;
		});
	}, [providers, models, globalApiKeyOptions, translate]);

	return (
		<BaseCELRuleBuilder
			onChange={onChange}
			initialQuery={normalizedInitialQuery}
			isLoading={isLoadingGlobalApiKeys}
			fields={fields}
			operators={celOperatorsRouting}
			convertToCEL={convertRuleGroupToCEL}
			validateRegex={validateRegexPattern}
			translate={translate}
			builderContext={{ allowCustomModels }}
		/>
	);
}

/**
 * CEL Rule Builder for Routing Rules
 * Thin wrapper around the reusable CELRuleBuilder with routing-specific config
 */

import { CELRuleBuilder as BaseCELRuleBuilder } from "@/components/ui/custom/celBuilder";
import { getRoutingFields, ROUTING_ADMIN_USER_ID } from "@/lib/config/celFieldsRouting";
import { celOperatorsRouting } from "@/lib/config/celOperatorsRouting";
import type { TranslateFn } from "@/lib/i18n";
import { useListAoneUsersQuery } from "@/lib/store/apis/aoneUsersApi";
import { useListGlobalApiKeysQuery } from "@/lib/store/apis/globalApiKeysApi";
import { convertRuleGroupToCEL, validateRegexPattern } from "@/lib/utils/celConverterRouting";
import { mergeGlobalApiKeyOptions, normalizeGlobalApiKeyFieldsInQuery } from "@/lib/utils/globalApiKeyRoutingOptions";
import { mergeRoutingUserOptions, normalizeUserFieldsInQuery } from "@/lib/utils/userRoutingOptions";
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
	const { data: usersData, isLoading: isLoadingUsers } = useListAoneUsersQuery({ limit: 500 });

	const globalApiKeyOptions = useMemo(() => {
		const fromApi = (globalApiKeysData?.api_keys ?? []).map((key) => ({
			id: key.id,
			name: key.name,
		}));
		const referencedValues = [
			...collectRuleFieldValues(initialQuery, "global_api_key_id"),
			...collectRuleFieldValues(initialQuery, "global_api_key_name"),
		];
		return mergeGlobalApiKeyOptions(fromApi, referencedValues);
	}, [globalApiKeysData, initialQuery]);

	const userOptions = useMemo(() => {
		const fromApi = (usersData?.users ?? []).map((user) => ({
			id: user.id,
			label: user.display_name || user.name || user.email || user.id,
		}));
		const referencedValues = collectRuleFieldValues(initialQuery, "user_id");
		return mergeRoutingUserOptions(
			[{ id: ROUTING_ADMIN_USER_ID, label: translate("routing.celBuilder.adminUser") }, ...fromApi],
			referencedValues,
		);
	}, [initialQuery, translate, usersData?.users]);

	const normalizedInitialQuery = useMemo(() => {
		const withUsers = normalizeUserFieldsInQuery(initialQuery, userOptions) ?? initialQuery;
		return normalizeGlobalApiKeyFieldsInQuery(withUsers, globalApiKeyOptions) ?? withUsers;
	}, [initialQuery, globalApiKeyOptions, userOptions]);

	const fields = useMemo(() => {
		const baseFields = getRoutingFields(providers, models, globalApiKeyOptions, userOptions);
		return baseFields.map((field) => {
			if (field.name === "global_api_key_id") {
				return {
					...field,
					label: translate("routing.celBuilder.adminApiKey"),
					description: translate("routing.celBuilder.adminApiKeyHint"),
					placeholder: translate("routing.celBuilder.selectAdminApiKey"),
				};
			}
			if (field.name === "global_api_key_name") {
				return {
					...field,
					label: translate("routing.celBuilder.adminApiKeyName"),
					description: translate("routing.celBuilder.adminApiKeyNameHint"),
					placeholder: translate("routing.celBuilder.selectAdminApiKey"),
				};
			}
			if (field.name === "user_id") {
				return {
					...field,
					label: translate("routing.celBuilder.user"),
					description: translate("routing.celBuilder.userHint"),
					placeholder: translate("routing.celBuilder.selectUser"),
				};
			}
			return field;
		});
	}, [providers, models, globalApiKeyOptions, userOptions, translate]);

	return (
		<BaseCELRuleBuilder
			onChange={onChange}
			initialQuery={normalizedInitialQuery}
			isLoading={isLoadingGlobalApiKeys || isLoadingUsers}
			fields={fields}
			operators={celOperatorsRouting}
			convertToCEL={convertRuleGroupToCEL}
			validateRegex={validateRegexPattern}
			translate={translate}
			builderContext={{ allowCustomModels }}
		/>
	);
}

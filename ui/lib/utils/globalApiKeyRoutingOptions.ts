import type { GlobalApiKeyOption } from "@/lib/config/celFieldsRouting";
import { RuleGroupType, RuleType } from "react-querybuilder";

export function mergeGlobalApiKeyOptions(apiKeys: GlobalApiKeyOption[], extraValues: string[]): GlobalApiKeyOption[] {
	const merged = new Map<string, GlobalApiKeyOption>();
	for (const key of apiKeys) {
		merged.set(key.id, key);
	}
	for (const value of extraValues) {
		const trimmed = value.trim();
		if (!trimmed || merged.has(trimmed)) {
			continue;
		}
		const byID = apiKeys.find((key) => key.id === trimmed);
		if (byID) {
			merged.set(byID.id, byID);
			continue;
		}
		const byName = apiKeys.find((key) => key.name === trimmed);
		if (byName) {
			merged.set(byName.id, byName);
			continue;
		}
		merged.set(trimmed, { id: trimmed, name: trimmed });
	}
	return Array.from(merged.values());
}

function normalizeIdRuleValue(value: RuleType["value"], apiKeys: GlobalApiKeyOption[]): RuleType["value"] {
	if (value == null || value === "") {
		return value;
	}

	const resolveValue = (raw: string): string => {
		const trimmed = raw.trim();
		if (!trimmed) {
			return trimmed;
		}
		if (apiKeys.some((key) => key.id === trimmed)) {
			return trimmed;
		}
		const byName = apiKeys.find((key) => key.name === trimmed);
		return byName?.id ?? trimmed;
	};

	return normalizeScalarOrArrayValue(value, resolveValue);
}

function normalizeNameRuleValue(value: RuleType["value"], apiKeys: GlobalApiKeyOption[]): RuleType["value"] {
	if (value == null || value === "") {
		return value;
	}

	const resolveValue = (raw: string): string => {
		const trimmed = raw.trim();
		if (!trimmed) {
			return trimmed;
		}
		if (apiKeys.some((key) => key.name === trimmed)) {
			return trimmed;
		}
		const byID = apiKeys.find((key) => key.id === trimmed);
		return byID?.name ?? trimmed;
	};

	return normalizeScalarOrArrayValue(value, resolveValue);
}

function normalizeScalarOrArrayValue(value: RuleType["value"], resolveValue: (raw: string) => string): RuleType["value"] {
	if (Array.isArray(value)) {
		return value.map((item) => resolveValue(String(item)));
	}

	if (typeof value === "string") {
		const raw = value.trim();
		if (raw.startsWith("[")) {
			try {
				const parsed = JSON.parse(raw);
				if (Array.isArray(parsed)) {
					return JSON.stringify(parsed.map((item) => resolveValue(String(item))));
				}
			} catch {
				// fall through
			}
		}
		return resolveValue(raw);
	}

	return value;
}

export function normalizeGlobalApiKeyFieldsInQuery(
	query: RuleGroupType | undefined,
	apiKeys: GlobalApiKeyOption[],
): RuleGroupType | undefined {
	if (!query?.rules?.length || apiKeys.length === 0) {
		return query;
	}

	const walk = (group: RuleGroupType): RuleGroupType => ({
		...group,
		rules: (group.rules ?? []).map((rule) => {
			if ("combinator" in rule && "rules" in rule) {
				return walk(rule as RuleGroupType);
			}
			const typedRule = rule as RuleType;
			if (typedRule.field === "global_api_key_id") {
				return {
					...typedRule,
					value: normalizeIdRuleValue(typedRule.value, apiKeys),
				};
			}
			if (typedRule.field === "global_api_key_name") {
				return {
					...typedRule,
					value: normalizeNameRuleValue(typedRule.value, apiKeys),
				};
			}
			return typedRule;
		}),
	});

	return walk(query);
}

/** @deprecated Use normalizeGlobalApiKeyFieldsInQuery */
export function normalizeGlobalApiKeyIdsInQuery(query: RuleGroupType | undefined, apiKeys: GlobalApiKeyOption[]): RuleGroupType | undefined {
	return normalizeGlobalApiKeyFieldsInQuery(query, apiKeys);
}

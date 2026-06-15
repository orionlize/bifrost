import type { RoutingUserOption } from "@/lib/config/celFieldsRouting";
import { RuleGroupType, RuleType } from "react-querybuilder";

export function mergeRoutingUserOptions(users: RoutingUserOption[], extraValues: string[]): RoutingUserOption[] {
	const merged = new Map<string, RoutingUserOption>();
	for (const user of users) {
		merged.set(user.id, user);
	}
	for (const value of extraValues) {
		const trimmed = value.trim();
		if (!trimmed || merged.has(trimmed)) {
			continue;
		}
		const byID = users.find((user) => user.id === trimmed);
		if (byID) {
			merged.set(byID.id, byID);
			continue;
		}
		merged.set(trimmed, { id: trimmed, label: trimmed });
	}
	return Array.from(merged.values());
}

export function normalizeUserFieldsInQuery(query: RuleGroupType | undefined, users: RoutingUserOption[]): RuleGroupType | undefined {
	if (!query?.rules?.length || users.length === 0) {
		return query;
	}

	const walk = (group: RuleGroupType): RuleGroupType => ({
		...group,
		rules: (group.rules ?? []).map((rule) => {
			if ("combinator" in rule && "rules" in rule) {
				return walk(rule as RuleGroupType);
			}
			const typedRule = rule as RuleType;
			if (typedRule.field !== "user_id") {
				return typedRule;
			}
			return {
				...typedRule,
				value: normalizeUserRuleValue(typedRule.value, users),
			};
		}),
	});

	return walk(query);
}

function normalizeUserRuleValue(value: RuleType["value"], users: RoutingUserOption[]): RuleType["value"] {
	if (value == null || value === "") {
		return value;
	}

	const resolveValue = (raw: string): string => {
		const trimmed = raw.trim();
		if (!trimmed) {
			return trimmed;
		}
		if (users.some((user) => user.id === trimmed)) {
			return trimmed;
		}
		const byLabel = users.find((user) => user.label === trimmed);
		return byLabel?.id ?? trimmed;
	};

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
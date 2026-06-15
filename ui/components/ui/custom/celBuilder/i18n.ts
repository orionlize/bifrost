import type { TranslateFn, TranslateParams } from "@/lib/i18n";

/** QueryBuilder context shape — `t` is injected by CELRuleBuilder from the parent tree. */
export type CelBuilderI18nContext = {
	t?: TranslateFn;
	[key: string]: unknown;
};

export function celBuilderT(context: CelBuilderI18nContext | undefined, key: string, params?: TranslateParams): string {
	return context?.t?.(key, params) ?? key;
}
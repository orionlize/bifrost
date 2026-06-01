import type { Locale, TranslateParams, TranslationTree, TranslationValue } from "./types";

export function detectBrowserLocale(): Locale {
	if (typeof navigator === "undefined") {
		return "en";
	}
	const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
	for (const raw of languages) {
		const lang = raw.toLowerCase();
		if (lang.startsWith("zh")) {
			return "zh";
		}
	}
	for (const raw of languages) {
		const lang = raw.toLowerCase();
		if (lang.startsWith("en")) {
			return "en";
		}
	}
	return "en";
}

export function resolveMessage(tree: TranslationTree, key: string): string | undefined {
	const parts = key.split(".");
	let current: TranslationValue | undefined = tree;
	for (const part of parts) {
		if (current == null || typeof current === "string") {
			return undefined;
		}
		current = current[part];
	}
	return typeof current === "string" ? current : undefined;
}

export function interpolate(template: string, params?: TranslateParams): string {
	if (!params) {
		return template;
	}
	return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => {
		const value = params[name];
		return value === undefined ? "" : String(value);
	});
}

export function createTranslator(
	tree: TranslationTree | Record<string, TranslationValue>,
	fallbackTree?: TranslationTree | Record<string, TranslationValue>,
) {
	return (key: string, params?: TranslateParams): string => {
		let message = resolveMessage(tree, key);
		if (message === undefined && fallbackTree) {
			message = resolveMessage(fallbackTree, key);
		}
		if (message === undefined) {
			return key;
		}
		return interpolate(message, params);
	};
}

export const localeLabels: Record<Locale, { native: string; english: string }> = {
	en: { native: "English", english: "English" },
	zh: { native: "中文", english: "Chinese" },
};

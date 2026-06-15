export type Locale = "en" | "zh";

export type TranslationValue = string | TranslationTree;

export type TranslationTree = {
	[key: string]: TranslationValue;
};

export type TranslateParams = Record<string, string | number>;
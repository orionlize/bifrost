import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { en } from "./locales/en";
import { zh } from "./locales/zh";
import { setDefaultOptions } from "date-fns";
import { getDateFnsLocale } from "./dateTime";
import { detectBrowserLocale, createTranslator } from "./utils";
import { readStoredLocale, writeStoredLocale } from "./storage";
import type { Locale, TranslateParams } from "./types";

const localeMessages = { en, zh } as const;

export type TranslateFn = (key: string, params?: TranslateParams) => string;

interface I18nContextValue {
	locale: Locale;
	setLocale: (locale: Locale) => void;
	t: TranslateFn;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function getInitialLocale(): Locale {
	return readStoredLocale() ?? detectBrowserLocale();
}

export function I18nProvider({ children }: { children: ReactNode }) {
	const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

	const setLocale = useCallback((next: Locale) => {
		setLocaleState(next);
		writeStoredLocale(next);
	}, []);

	const t = useMemo(
		() => createTranslator(localeMessages[locale], locale === "zh" ? localeMessages.en : undefined),
		[locale],
	);

	useEffect(() => {
		document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
		setDefaultOptions({ locale: getDateFnsLocale(locale) });
	}, [locale]);

	const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);

	return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
	const ctx = useContext(I18nContext);
	if (!ctx) {
		throw new Error("useI18n must be used within I18nProvider");
	}
	return ctx;
}

export function useT(): TranslateFn {
	return useI18n().t;
}

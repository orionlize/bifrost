import type { Locale } from "./types";

export const LOCALE_STORAGE_KEY = "bifrost_locale";

export function readStoredLocale(): Locale | null {
	if (typeof window === "undefined") {
		return null;
	}
	const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
	if (stored === "en" || stored === "zh") {
		return stored;
	}
	return null;
}

export function writeStoredLocale(locale: Locale): void {
	if (typeof window === "undefined") {
		return;
	}
	window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}
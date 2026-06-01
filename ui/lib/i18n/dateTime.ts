import { formatDistanceToNow } from "date-fns";
import { enUS, zhCN } from "date-fns/locale";
import type { Locale } from "./types";

const DATE_FNS_LOCALES = { en: enUS, zh: zhCN } as const;

const SHANGHAI_TZ = "Asia/Shanghai";

export function getDateFnsLocale(locale: Locale) {
	return DATE_FNS_LOCALES[locale];
}

/** Relative time in the active UI locale (e.g. "3 days ago" / "3 天前"). */
export function formatRelativeTimeLocalized(value: string | undefined, locale: Locale): string {
	if (!value) {
		return "-";
	}
	const date = parseDateInput(value);
	if (!date) {
		return "-";
	}
	return formatDistanceToNow(date, { addSuffix: true, locale: getDateFnsLocale(locale) });
}

/**
 * Calendar date in China Standard Time (UTC+8). Handles Unix timestamps (s or ms) and ISO strings.
 */
export function formatDateShanghai(value: string | undefined, locale: Locale): string {
	if (!value) {
		return "-";
	}
	const date = parseDateInput(value);
	if (!date) {
		return value;
	}
	return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
		timeZone: SHANGHAI_TZ,
		year: "numeric",
		month: "short",
		day: "numeric",
	}).format(date);
}

/**
 * Date and time in China Standard Time (UTC+8).
 */
export function formatDateTimeShanghai(value: string | undefined, locale: Locale): string {
	if (!value) {
		return "-";
	}
	const date = parseDateInput(value);
	if (!date) {
		return value;
	}
	return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
		timeZone: SHANGHAI_TZ,
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

function parseDateInput(value: string): Date | null {
	const trimmed = value.trim();
	if (/^\d+$/.test(trimmed)) {
		const n = Number(trimmed);
		if (!Number.isFinite(n)) {
			return null;
		}
		const ms = trimmed.length <= 10 ? n * 1000 : n;
		const date = new Date(ms);
		return Number.isNaN(date.getTime()) ? null : date;
	}
	const date = new Date(trimmed);
	return Number.isNaN(date.getTime()) ? null : date;
}

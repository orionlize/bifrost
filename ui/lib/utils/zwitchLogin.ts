import { stripBasePath } from "@/lib/utils/basePath";

export const LOGIN_SOURCE_ZWITCH = "zwitch";
export const LOGIN_ZWITCH_SUCCESS_PATH = "/login/zwitch/success";
export const LOGIN_SOURCE_STORAGE_KEY = "bifrost.login.source";
export const ZWITCH_AUTH_STORAGE_KEY = "bifrost.zwitch.auth";
/** Must match zwitch `DEEPLINK_SCHEME` / `DEEPLINK_HOST` in src-tauri/src/config.rs */
export const ZWITCH_DEEPLINK_SCHEME = "zwitch";
export const ZWITCH_DEEPLINK_HOST = "open";
export const ZWITCH_BASE_URL_QUERY_KEY = "base_url";

export type ZwitchAuthByBaseUrl = Record<string, string>;

export function normalizeLoginSource(value: string | null | undefined): string | null {
	if (value?.trim() === LOGIN_SOURCE_ZWITCH) {
		return LOGIN_SOURCE_ZWITCH;
	}
	return null;
}

export function normalizeZwitchBaseUrl(value: string | null | undefined): string | null {
	if (!value?.trim()) {
		return null;
	}
	try {
		const parsed = new URL(value.trim());
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return null;
		}
		parsed.pathname = "";
		parsed.search = "";
		parsed.hash = "";
		let normalized = parsed.toString().replace(/\/$/, "");
		if (normalized === "http://localhost:3000" || normalized === "http://127.0.0.1:3000") {
			normalized = normalized.replace(":3000", ":8080");
		}
		return normalized;
	} catch {
		return null;
	}
}

export function readZwitchAuthByBaseUrl(): ZwitchAuthByBaseUrl {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		const raw = sessionStorage.getItem(ZWITCH_AUTH_STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const result: ZwitchAuthByBaseUrl = {};
		for (const [key, value] of Object.entries(parsed)) {
			const baseUrl = normalizeZwitchBaseUrl(key);
			if (!baseUrl || typeof value !== "string" || !value.trim()) {
				continue;
			}
			result[baseUrl] = value.trim();
		}
		return result;
	} catch {
		return {};
	}
}

export function stashZwitchAuth(baseUrl: string, accessToken: string): void {
	if (typeof window === "undefined") {
		return;
	}
	const normalizedBaseUrl = normalizeZwitchBaseUrl(baseUrl);
	const token = accessToken.trim();
	if (!normalizedBaseUrl || !token) {
		return;
	}
	try {
		const authByBaseUrl = readZwitchAuthByBaseUrl();
		authByBaseUrl[normalizedBaseUrl] = token;
		sessionStorage.setItem(ZWITCH_AUTH_STORAGE_KEY, JSON.stringify(authByBaseUrl));
	} catch {
		// Ignore storage failures.
	}
}

export function readZwitchAuthForBaseUrl(baseUrl: string): string | null {
	const normalizedBaseUrl = normalizeZwitchBaseUrl(baseUrl);
	if (!normalizedBaseUrl) {
		return null;
	}
	return readZwitchAuthByBaseUrl()[normalizedBaseUrl] ?? null;
}

export function getLoginSourceFromSearch(search: string): string | null {
	return normalizeLoginSource(new URLSearchParams(search).get("source"));
}

export function stashLoginSource(source: string): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		sessionStorage.setItem(LOGIN_SOURCE_STORAGE_KEY, source);
	} catch {
		// Ignore storage failures.
	}
}

export function clearStashedLoginSource(): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		sessionStorage.removeItem(LOGIN_SOURCE_STORAGE_KEY);
	} catch {
		// Ignore storage failures.
	}
}

export function readStashedLoginSource(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return normalizeLoginSource(sessionStorage.getItem(LOGIN_SOURCE_STORAGE_KEY));
	} catch {
		return null;
	}
}

export function readLoginSourceFromWindow(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return getLoginSourceFromSearch(window.location.search);
}

export function resolveLoginSourceForOAuth(): string | null {
	return readLoginSourceFromWindow() ?? readStashedLoginSource();
}

export function syncLoginSourceStashFromLocation(): void {
	const fromUrl = readLoginSourceFromWindow();
	if (fromUrl) {
		stashLoginSource(fromUrl);
		return;
	}
	if (typeof window !== "undefined" && stripBasePath(window.location.pathname).startsWith("/login")) {
		clearStashedLoginSource();
	}
}

export function buildZwitchDeeplink(accessToken: string, baseUrl?: string | null): string {
	const url = new URL(`${ZWITCH_DEEPLINK_SCHEME}://${ZWITCH_DEEPLINK_HOST}`);
	url.searchParams.set("access_token", accessToken);
	const normalizedBaseUrl = normalizeZwitchBaseUrl(baseUrl ?? undefined);
	if (normalizedBaseUrl) {
		url.searchParams.set(ZWITCH_BASE_URL_QUERY_KEY, normalizedBaseUrl);
	}
	return url.toString();
}

/** Opens Zwitch via custom URL scheme. Requires the desktop app to be installed or running. */
export function openZwitchDeeplink(accessToken: string, baseUrl?: string | null): void {
	const deeplink = buildZwitchDeeplink(accessToken, baseUrl);
	const anchor = document.createElement("a");
	anchor.href = deeplink;
	anchor.rel = "noopener noreferrer";
	anchor.style.display = "none";
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
}

export function resolveZwitchSuccessParams(search: string): {
	accessToken: string;
	baseUrl: string | null;
} {
	const params = new URLSearchParams(search);
	const accessToken = params.get("access_token")?.trim() ?? "";
	const baseUrl =
		normalizeZwitchBaseUrl(params.get(ZWITCH_BASE_URL_QUERY_KEY)) ??
		(typeof window !== "undefined" ? normalizeZwitchBaseUrl(window.location.origin) : null);
	return { accessToken, baseUrl };
}
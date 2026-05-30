export const LOGIN_SOURCE_ZD_SWITCH = "zd-switch";
export const LOGIN_ZD_SWITCH_SUCCESS_PATH = "/login/zd-switch/success";
export const LOGIN_SOURCE_STORAGE_KEY = "bifrost.login.source";
export const ZD_SWITCH_AUTH_STORAGE_KEY = "bifrost.zd-switch.auth";
/** Must match zd-switch `DEEPLINK_SCHEME` / `DEEPLINK_HOST` in src-tauri/src/config.rs */
export const ZD_SWITCH_DEEPLINK_SCHEME = "zd-switch";
export const ZD_SWITCH_DEEPLINK_HOST = "open";
export const ZD_SWITCH_BASE_URL_QUERY_KEY = "base_url";

export type ZdSwitchAuthByBaseUrl = Record<string, string>;

export function normalizeLoginSource(value: string | null | undefined): string | null {
	if (value?.trim() === LOGIN_SOURCE_ZD_SWITCH) {
		return LOGIN_SOURCE_ZD_SWITCH;
	}
	return null;
}

export function normalizeZdSwitchBaseUrl(value: string | null | undefined): string | null {
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

export function readZdSwitchAuthByBaseUrl(): ZdSwitchAuthByBaseUrl {
	if (typeof window === "undefined") {
		return {};
	}
	try {
		const raw = sessionStorage.getItem(ZD_SWITCH_AUTH_STORAGE_KEY);
		if (!raw) {
			return {};
		}
		const parsed = JSON.parse(raw) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return {};
		}
		const result: ZdSwitchAuthByBaseUrl = {};
		for (const [key, value] of Object.entries(parsed)) {
			const baseUrl = normalizeZdSwitchBaseUrl(key);
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

export function stashZdSwitchAuth(baseUrl: string, accessToken: string): void {
	if (typeof window === "undefined") {
		return;
	}
	const normalizedBaseUrl = normalizeZdSwitchBaseUrl(baseUrl);
	const token = accessToken.trim();
	if (!normalizedBaseUrl || !token) {
		return;
	}
	try {
		const authByBaseUrl = readZdSwitchAuthByBaseUrl();
		authByBaseUrl[normalizedBaseUrl] = token;
		sessionStorage.setItem(ZD_SWITCH_AUTH_STORAGE_KEY, JSON.stringify(authByBaseUrl));
	} catch {
		// Ignore storage failures.
	}
}

export function readZdSwitchAuthForBaseUrl(baseUrl: string): string | null {
	const normalizedBaseUrl = normalizeZdSwitchBaseUrl(baseUrl);
	if (!normalizedBaseUrl) {
		return null;
	}
	return readZdSwitchAuthByBaseUrl()[normalizedBaseUrl] ?? null;
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
	if (typeof window !== "undefined" && window.location.pathname.startsWith("/login")) {
		clearStashedLoginSource();
	}
}

export function buildZdSwitchDeeplink(accessToken: string, baseUrl?: string | null): string {
	const url = new URL(`${ZD_SWITCH_DEEPLINK_SCHEME}://${ZD_SWITCH_DEEPLINK_HOST}`);
	url.searchParams.set("access_token", accessToken);
	const normalizedBaseUrl = normalizeZdSwitchBaseUrl(baseUrl ?? undefined);
	if (normalizedBaseUrl) {
		url.searchParams.set(ZD_SWITCH_BASE_URL_QUERY_KEY, normalizedBaseUrl);
	}
	return url.toString();
}

/** Opens ZD Switch via custom URL scheme. Requires the desktop app to be installed or running. */
export function openZdSwitchDeeplink(accessToken: string, baseUrl?: string | null): void {
	const deeplink = buildZdSwitchDeeplink(accessToken, baseUrl);
	const anchor = document.createElement("a");
	anchor.href = deeplink;
	anchor.rel = "noopener noreferrer";
	anchor.style.display = "none";
	document.body.appendChild(anchor);
	anchor.click();
	document.body.removeChild(anchor);
}

export async function copyAccessTokenToClipboard(accessToken: string): Promise<boolean> {
	if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
		return false;
	}
	try {
		await navigator.clipboard.writeText(accessToken);
		return true;
	} catch {
		return false;
	}
}

export function resolveZdSwitchSuccessParams(search: string): {
	accessToken: string;
	baseUrl: string | null;
} {
	const params = new URLSearchParams(search);
	const accessToken = params.get("access_token")?.trim() ?? "";
	const baseUrl =
		normalizeZdSwitchBaseUrl(params.get(ZD_SWITCH_BASE_URL_QUERY_KEY)) ??
		(typeof window !== "undefined" ? normalizeZdSwitchBaseUrl(window.location.origin) : null);
	return { accessToken, baseUrl };
}
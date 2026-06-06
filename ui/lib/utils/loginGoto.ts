import { stripBasePath, withBasePath } from "@/lib/utils/basePath";

export const DEFAULT_POST_LOGIN_PATH = "/workspace";
export const LOGIN_COMPLETE_PATH = "/login/complete";
export const LOGIN_REDIRECT_URI_STORAGE_KEY = "bifrost.login.post_login_redirect";

const LOGIN_REDIRECT_PARAM_KEY = "redirect_uri";

export function buildLoginCompleteSearch(redirectUri: string): { redirect_uri: string } {
	return { redirect_uri: redirectUri };
}

export function normalizeLoginRedirectUri(value: string | null | undefined): string | null {
	if (!value || value.startsWith("//") || value.includes("\\") || value.includes("\n") || value.includes("\r")) {
		return null;
	}

	const trimmed = value.trim();
	if (isInternalRedirectPath(trimmed)) {
		return trimmed;
	}
	if (isExternalRedirectUrl(trimmed)) {
		return trimmed;
	}
	return null;
}

export function getLoginRedirectUriFromSearch(search: string): string | null {
	return normalizeLoginRedirectUri(new URLSearchParams(search).get(LOGIN_REDIRECT_PARAM_KEY));
}

export function stashLoginRedirectUri(redirectUri: string): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		sessionStorage.setItem(LOGIN_REDIRECT_URI_STORAGE_KEY, redirectUri);
	} catch {
		// Ignore storage failures (private mode, quota, etc.).
	}
}

export function clearStashedLoginRedirectUri(): void {
	if (typeof window === "undefined") {
		return;
	}
	try {
		sessionStorage.removeItem(LOGIN_REDIRECT_URI_STORAGE_KEY);
	} catch {
		// Ignore storage failures.
	}
}

export function readStashedLoginRedirectUri(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return normalizeLoginRedirectUri(sessionStorage.getItem(LOGIN_REDIRECT_URI_STORAGE_KEY));
	} catch {
		return null;
	}
}

export function readLoginRedirectUriFromWindow(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	return getLoginRedirectUriFromSearch(window.location.search);
}

export function resolveLoginRedirectUriFromUrl(): string | null {
	return readLoginRedirectUriFromWindow();
}

export function resolveLoginRedirectUriForOAuth(): string | null {
	return resolveLoginRedirectUriFromUrl() ?? readStashedLoginRedirectUri();
}

export function syncLoginRedirectStashFromLocation(): void {
	const fromUrl = resolveLoginRedirectUriFromUrl();
	if (fromUrl) {
		stashLoginRedirectUri(fromUrl);
		return;
	}
	if (typeof window !== "undefined" && stripBasePath(window.location.pathname).startsWith("/login")) {
		clearStashedLoginRedirectUri();
	}
}

export { syncLoginSourceStashFromLocation } from "@/lib/utils/zwitchLogin";

export function isExternalRedirectUrl(value: string): boolean {
	try {
		const parsed = new URL(value);
		return (parsed.protocol === "http:" || parsed.protocol === "https:") && parsed.host !== "";
	} catch {
		return false;
	}
}

export function buildLoginCompletePath(redirectUri: string): string {
	const params = new URLSearchParams(buildLoginCompleteSearch(redirectUri));
	return withBasePath(`${LOGIN_COMPLETE_PATH}?${params.toString()}`);
}

export function buildLoginCompleteUrl(redirectUri: string): string {
	if (typeof window === "undefined") {
		return buildLoginCompletePath(redirectUri);
	}
	return `${window.location.origin}${buildLoginCompletePath(redirectUri)}`;
}

export function appendApiKeyToRedirectUrl(target: string, apiKey: string): string {
	try {
		const base = typeof window !== "undefined" ? window.location.origin : "http://localhost";
		const url = isExternalRedirectUrl(target) ? new URL(target) : new URL(target, base);
		url.searchParams.set("api_key", apiKey);
		return url.toString();
	} catch {
		return target;
	}
}

function isInternalRedirectPath(value: string): boolean {
	return (
		value.startsWith("/") &&
		!value.startsWith("//") &&
		(value === DEFAULT_POST_LOGIN_PATH ||
			value.startsWith(`${DEFAULT_POST_LOGIN_PATH}/`) ||
			value.startsWith(`${DEFAULT_POST_LOGIN_PATH}?`) ||
			value.startsWith(`${DEFAULT_POST_LOGIN_PATH}#`) ||
			value.startsWith("/login") ||
			value.startsWith("/workspace/"))
	);
}
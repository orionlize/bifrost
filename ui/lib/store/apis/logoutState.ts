let loggingOut = false;

export function setLoggingOut(value: boolean): void {
	loggingOut = value;
}

export function getLoggingOut(): boolean {
	return loggingOut;
}

function requestUrl(args: unknown): string {
	if (typeof args === "string") {
		return args;
	}
	if (typeof args === "object" && args !== null && "url" in args) {
		return String((args as { url?: string }).url ?? "");
	}
	return "";
}

export function isLogoutRequest(args: unknown): boolean {
	const url = requestUrl(args);
	return url.includes("/session/logout") || url.includes("/scim/oauth/logout");
}

/** Requests that must still run while the logout mutation is in flight. */
export function isAllowedDuringLogout(args: unknown): boolean {
	const url = requestUrl(args);
	return isLogoutRequest(args) || url.includes("/session/is-auth-enabled");
}
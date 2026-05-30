let loggingOut = false;

export function setLoggingOut(value: boolean): void {
	loggingOut = value;
}

export function getLoggingOut(): boolean {
	return loggingOut;
}

export function isLogoutRequest(args: unknown): boolean {
	const url =
		typeof args === "string"
			? args
			: typeof args === "object" && args !== null && "url" in args
				? String((args as { url?: string }).url ?? "")
				: "";
	return url.includes("/session/logout") || url.includes("/scim/oauth/logout");
}
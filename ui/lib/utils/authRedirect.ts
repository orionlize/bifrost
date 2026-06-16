import { DEFAULT_POST_LOGIN_PATH } from "@/lib/utils/loginGoto";
import type { IsAuthEnabledResponse } from "@/lib/store/apis/sessionApi";
import { getEndpointUrl } from "@/lib/utils/port";

export async function probeAuthSession(): Promise<IsAuthEnabledResponse | null> {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		const response = await fetch(getEndpointUrl("/api/session/is-auth-enabled"), {
			credentials: "include",
			cache: "no-store",
		});
		if (!response.ok) {
			return null;
		}
		return (await response.json()) as IsAuthEnabledResponse;
	} catch {
		return null;
	}
}

/** True when the visitor should enter the dashboard instead of the login page. */
export function shouldEnterDashboard(auth: IsAuthEnabledResponse | null | undefined): boolean {
	if (!auth) {
		return false;
	}
	return auth.is_auth_enabled !== true || auth.has_valid_token === true;
}

/** True when an admin session is already active and /admin-login should redirect away. */
export function shouldRedirectFromAdminLogin(auth: IsAuthEnabledResponse | null | undefined): boolean {
	if (!auth) {
		return false;
	}
	if (auth.is_auth_enabled !== true) {
		return true;
	}
	return auth.is_local_admin_session === true;
}

export function defaultAuthenticatedPath(): string {
	return DEFAULT_POST_LOGIN_PATH;
}
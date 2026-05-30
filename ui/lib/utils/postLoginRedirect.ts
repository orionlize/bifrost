import { fetchAndCacheAoneApiKey } from "@/lib/utils/aoneUserStorage";
import {
	appendApiKeyToRedirectUrl,
	DEFAULT_POST_LOGIN_PATH,
	isExternalRedirectUrl,
	normalizeLoginRedirectUri,
} from "@/lib/utils/loginGoto";

export async function executePostLoginRedirect(redirectUri: string): Promise<void> {
	const normalized = normalizeLoginRedirectUri(redirectUri);
	if (!normalized) {
		window.location.replace(DEFAULT_POST_LOGIN_PATH);
		return;
	}

	let target = normalized;
	const apiKey = await fetchAndCacheAoneApiKey();
	if (apiKey) {
		target = appendApiKeyToRedirectUrl(normalized, apiKey);
	}

	if (isExternalRedirectUrl(target)) {
		window.location.replace(target);
		return;
	}

	window.location.replace(target.startsWith("/") ? `${window.location.origin}${target}` : target);
}
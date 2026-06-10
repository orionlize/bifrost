import type { GlobalApiKey } from "@/lib/store/apis/globalApiKeysApi";
import {
	GLOBAL_API_KEY_PLACEHOLDER,
	getStoredGlobalApiKey,
	isFullGlobalApiKeyToken,
} from "@/lib/utils/globalApiKeyStorage";

export function pickQuickStartGlobalApiKey(
	apiKeys: GlobalApiKey[],
	preferredKeyId?: string | null,
): GlobalApiKey | null {
	if (apiKeys.length === 0) {
		return null;
	}

	const preferred = preferredKeyId?.trim();
	if (preferred) {
		const selected = apiKeys.find((key) => key.id === preferred);
		if (selected) {
			return selected;
		}
	}

	return apiKeys[0];
}

function normalizeGlobalApiKeyCandidate(token: string | null | undefined): string | null {
	const trimmed = token?.trim();
	return trimmed ? trimmed : null;
}

export function resolveQuickStartApiKeyToken(
	selectedKey: GlobalApiKey | null,
	fetchedToken?: string | null,
): string {
	if (!selectedKey) {
		return GLOBAL_API_KEY_PLACEHOLDER;
	}

	const candidates = [
		normalizeGlobalApiKeyCandidate(fetchedToken),
		normalizeGlobalApiKeyCandidate(selectedKey.token),
		normalizeGlobalApiKeyCandidate(getStoredGlobalApiKey(selectedKey.id)),
	];
	for (const candidate of candidates) {
		if (isFullGlobalApiKeyToken(candidate)) {
			return candidate;
		}
	}

	return GLOBAL_API_KEY_PLACEHOLDER;
}

const GLOBAL_API_KEY_STORAGE_KEY = "bifrost-global-api-key";
const GLOBAL_API_KEY_BY_ID_PREFIX = "bifrost-global-api-key:";
const GLOBAL_API_KEY_SELECTED_ID_KEY = "bifrost-global-api-key-selected-id";

export const GLOBAL_API_KEY_PLACEHOLDER = "your-api-key";
export const GLOBAL_API_KEY_TOKEN_PREFIX = "bf-ak-";

export type GlobalApiKeySelectionSource = {
	id: string;
	token?: string;
	token_prefix?: string;
};

export function getStoredGlobalApiKeySelectedId(): string | null {
	try {
		const stored = localStorage.getItem(GLOBAL_API_KEY_SELECTED_ID_KEY);
		return stored?.trim() ? stored.trim() : null;
	} catch {
		return null;
	}
}

export function setStoredGlobalApiKeySelectedId(keyId: string): void {
	try {
		const trimmed = keyId.trim();
		if (!trimmed) {
			return;
		}
		localStorage.setItem(GLOBAL_API_KEY_SELECTED_ID_KEY, trimmed);
	} catch {
		// Ignore storage failures in private browsing or restricted environments.
	}
}

export function formatGlobalApiKeyLabel(name: string, tokenPrefix: string): string {
	return `${name} (${tokenPrefix})`;
}

export function isUsableApiKeyToken(token: string | null | undefined): token is string {
	if (!token) {
		return false;
	}
	const trimmed = token.trim();
	return trimmed.length > 0 && trimmed !== GLOBAL_API_KEY_PLACEHOLDER;
}

export function isGlobalApiKeyToken(token: string | null | undefined): token is string {
	return isUsableApiKeyToken(token) && token.startsWith(GLOBAL_API_KEY_TOKEN_PREFIX);
}

/** Full bf-ak- tokens are longer than dropdown prefixes like bf-ak-abcd12... */
export function isFullGlobalApiKeyToken(token: string | null | undefined): token is string {
	if (!isGlobalApiKeyToken(token)) {
		return false;
	}
	if (token.endsWith("...")) {
		return false;
	}
	const hexPart = token.slice(GLOBAL_API_KEY_TOKEN_PREFIX.length);
	return /^[0-9a-f]{32,}$/i.test(hexPart);
}

export function resolveGlobalApiKeySelection(
	apiKeys: GlobalApiKeySelectionSource[],
	preferredKeyId?: string | null,
): { keyId: string; token: string } | null {
	if (apiKeys.length === 0) {
		return null;
	}

	const preferred = preferredKeyId?.trim();
	const selectedKey = (preferred ? apiKeys.find((key) => key.id === preferred) : undefined) ?? apiKeys[0];

	const token =
		[isFullGlobalApiKeyToken(selectedKey.token?.trim()) ? selectedKey.token.trim() : null, getStoredGlobalApiKey(selectedKey.id)].find(
			isFullGlobalApiKeyToken,
		) ?? GLOBAL_API_KEY_PLACEHOLDER;
	return { keyId: selectedKey.id, token };
}

export function getStoredGlobalApiKey(keyId?: string): string | null {
	try {
		if (keyId) {
			const perKey = localStorage.getItem(`${GLOBAL_API_KEY_BY_ID_PREFIX}${keyId}`);
			return perKey?.trim() ? perKey.trim() : null;
		}
		const legacy = localStorage.getItem(GLOBAL_API_KEY_STORAGE_KEY);
		return legacy?.trim() ? legacy.trim() : null;
	} catch {
		return null;
	}
}

export function setStoredGlobalApiKey(token: string, keyId?: string): void {
	try {
		const trimmed = token.trim();
		if (!isFullGlobalApiKeyToken(trimmed)) {
			return;
		}
		if (keyId) {
			localStorage.setItem(`${GLOBAL_API_KEY_BY_ID_PREFIX}${keyId}`, trimmed);
		}
		localStorage.setItem(GLOBAL_API_KEY_STORAGE_KEY, trimmed);
	} catch {
		// Ignore storage failures in private browsing or restricted environments.
	}
}

export function clearStoredGlobalApiKey(keyId?: string): void {
	try {
		if (keyId) {
			localStorage.removeItem(`${GLOBAL_API_KEY_BY_ID_PREFIX}${keyId}`);
		}
		localStorage.removeItem(GLOBAL_API_KEY_STORAGE_KEY);
	} catch {
		// Ignore storage failures.
	}
}
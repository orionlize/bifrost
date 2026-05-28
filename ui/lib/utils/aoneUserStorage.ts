import { getEndpointUrl } from "@/lib/utils/port";

const AONE_API_KEY_STORAGE_KEY = "bifrost-aone-api-key";

export function getAoneApiKey(): string | null {
	if (typeof window === "undefined") {
		return null;
	}
	try {
		return localStorage.getItem(AONE_API_KEY_STORAGE_KEY);
	} catch {
		return null;
	}
}

export function setAoneApiKey(apiKey: string | null | undefined) {
	if (typeof window === "undefined") {
		return;
	}
	try {
		if (!apiKey) {
			localStorage.removeItem(AONE_API_KEY_STORAGE_KEY);
			return;
		}
		localStorage.setItem(AONE_API_KEY_STORAGE_KEY, apiKey);
	} catch {
		// ignore storage failures
	}
}

export function clearAoneApiKey() {
	setAoneApiKey(null);
}

export async function fetchAndCacheAoneApiKey(): Promise<string | null> {
	try {
		const response = await fetch(getEndpointUrl("/api/aone/users/me"), {
			credentials: "include",
		});
		if (!response.ok) {
			return null;
		}
		const data = (await response.json()) as { api_key?: string };
		if (data.api_key) {
			setAoneApiKey(data.api_key);
			return data.api_key;
		}
	} catch {
		return null;
	}
	return null;
}

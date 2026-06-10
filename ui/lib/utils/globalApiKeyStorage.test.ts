import { beforeEach, describe, expect, it } from "vitest";
import {
	GLOBAL_API_KEY_PLACEHOLDER,
	getStoredGlobalApiKey,
	isFullGlobalApiKeyToken,
	isGlobalApiKeyToken,
	isUsableApiKeyToken,
	resolveGlobalApiKeySelection,
	setStoredGlobalApiKey,
} from "./globalApiKeyStorage";

const FULL_GLOBAL_API_KEY = `bf-ak-${"a".repeat(48)}`;
const CACHED_GLOBAL_API_KEY = `bf-ak-${"b".repeat(48)}`;

function createStorageMock() {
	const store = new Map<string, string>();
	return {
		getItem: (key: string) => store.get(key) ?? null,
		setItem: (key: string, value: string) => {
			store.set(key, value);
		},
		removeItem: (key: string) => {
			store.delete(key);
		},
		clear: () => {
			store.clear();
		},
	};
}

describe("resolveGlobalApiKeySelection", () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, "localStorage", {
			value: createStorageMock(),
			configurable: true,
		});
	});

	it("prefers api token over legacy local storage for the selected key", () => {
		setStoredGlobalApiKey(CACHED_GLOBAL_API_KEY);
		const resolved = resolveGlobalApiKeySelection([{ id: "key-1", token: FULL_GLOBAL_API_KEY }]);

		expect(resolved).toEqual({
			keyId: "key-1",
			token: FULL_GLOBAL_API_KEY,
		});
	});

	it("uses per-key storage when api token is missing", () => {
		setStoredGlobalApiKey(CACHED_GLOBAL_API_KEY, "key-1");
		const resolved = resolveGlobalApiKeySelection([{ id: "key-1" }]);

		expect(resolved).toEqual({
			keyId: "key-1",
			token: CACHED_GLOBAL_API_KEY,
		});
		expect(getStoredGlobalApiKey("key-1")).toBe(CACHED_GLOBAL_API_KEY);
		expect(getStoredGlobalApiKey("key-2")).toBeNull();
	});

	it("ignores non-global tokens from api and storage", () => {
		setStoredGlobalApiKey("sk-bf-personal-key", "key-1");
		const resolved = resolveGlobalApiKeySelection([{ id: "key-1", token: "sk-bf-personal-key" }]);
		expect(resolved?.token).toBe(GLOBAL_API_KEY_PLACEHOLDER);
		expect(getStoredGlobalApiKey("key-1")).toBeNull();
	});

	it("rejects token_prefix and falls back to placeholder", () => {
		const resolved = resolveGlobalApiKeySelection([{ id: "key-1", token_prefix: "bf-ak-prefix..." }]);
		expect(resolved?.token).toBe(GLOBAL_API_KEY_PLACEHOLDER);
	});

	it("falls back to placeholder when no token is available", () => {
		const resolved = resolveGlobalApiKeySelection([{ id: "key-1" }]);
		expect(resolved?.token).toBe(GLOBAL_API_KEY_PLACEHOLDER);
	});
});

describe("isFullGlobalApiKeyToken", () => {
	it("accepts full bf-ak tokens and rejects prefixes", () => {
		expect(isFullGlobalApiKeyToken(FULL_GLOBAL_API_KEY)).toBe(true);
		expect(isFullGlobalApiKeyToken("bf-ak-abcd12...")).toBe(false);
		expect(isFullGlobalApiKeyToken("sk-bf-personal-key")).toBe(false);
		expect(isFullGlobalApiKeyToken(GLOBAL_API_KEY_PLACEHOLDER)).toBe(false);
	});
});

describe("isGlobalApiKeyToken", () => {
	it("accepts bf-ak prefixes for display checks", () => {
		expect(isGlobalApiKeyToken("bf-ak-abcd12...")).toBe(true);
		expect(isGlobalApiKeyToken("sk-bf-personal-key")).toBe(false);
	});
});

describe("isUsableApiKeyToken", () => {
	it("rejects placeholder values", () => {
		expect(isUsableApiKeyToken(GLOBAL_API_KEY_PLACEHOLDER)).toBe(false);
		expect(isUsableApiKeyToken(FULL_GLOBAL_API_KEY)).toBe(true);
	});
});

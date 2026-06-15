import type { GlobalApiKey } from "@/lib/store/apis/globalApiKeysApi";
import { beforeEach, describe, expect, it } from "vitest";
import { GLOBAL_API_KEY_PLACEHOLDER, setStoredGlobalApiKey } from "./globalApiKeyStorage";
import { pickQuickStartGlobalApiKey, resolveQuickStartApiKeyToken } from "./resolveQuickStartApiKey";

const FULL_GLOBAL_API_KEY = `bf-ak-${"a".repeat(48)}`;
const CACHED_GLOBAL_API_KEY = `bf-ak-${"b".repeat(48)}`;
const FETCHED_GLOBAL_API_KEY = `bf-ak-${"c".repeat(48)}`;

function makeGlobalApiKey(overrides: Partial<GlobalApiKey> & Pick<GlobalApiKey, "id" | "name">): GlobalApiKey {
	return {
		token_prefix: "bf-ak-111...",
		is_active: true,
		created_at: "2026-01-01T00:00:00Z",
		updated_at: "2026-01-01T00:00:00Z",
		...overrides,
	};
}

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

describe("pickQuickStartGlobalApiKey", () => {
	it("defaults to the first assigned key", () => {
		const selected = pickQuickStartGlobalApiKey([
			makeGlobalApiKey({ id: "key-1", name: "first" }),
			makeGlobalApiKey({ id: "key-2", name: "second", token_prefix: "bf-ak-222..." }),
		]);

		expect(selected?.id).toBe("key-1");
	});

	it("uses the explicitly selected key", () => {
		const selected = pickQuickStartGlobalApiKey(
			[makeGlobalApiKey({ id: "key-1", name: "first" }), makeGlobalApiKey({ id: "key-2", name: "second", token_prefix: "bf-ak-222..." })],
			"key-2",
		);

		expect(selected?.id).toBe("key-2");
	});
});

describe("resolveQuickStartApiKeyToken", () => {
	beforeEach(() => {
		Object.defineProperty(globalThis, "localStorage", {
			value: createStorageMock(),
			configurable: true,
		});
	});

	it("prefers fetched full token for the selected key", () => {
		const token = resolveQuickStartApiKeyToken(makeGlobalApiKey({ id: "key-1", name: "first" }), FETCHED_GLOBAL_API_KEY);

		expect(token).toBe(FETCHED_GLOBAL_API_KEY);
	});

	it("uses access full token when fetch is unavailable", () => {
		const token = resolveQuickStartApiKeyToken(makeGlobalApiKey({ id: "key-1", name: "first", token: FULL_GLOBAL_API_KEY }));

		expect(token).toBe(FULL_GLOBAL_API_KEY);
	});

	it("rejects token_prefix and falls back to placeholder", () => {
		const token = resolveQuickStartApiKeyToken(makeGlobalApiKey({ id: "key-1", name: "first" }));

		expect(token).toBe(GLOBAL_API_KEY_PLACEHOLDER);
	});

	it("uses cached full global token for the selected key", () => {
		setStoredGlobalApiKey(CACHED_GLOBAL_API_KEY, "key-1");
		const token = resolveQuickStartApiKeyToken(makeGlobalApiKey({ id: "key-1", name: "first" }));

		expect(token).toBe(CACHED_GLOBAL_API_KEY);
	});
});
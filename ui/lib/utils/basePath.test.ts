import { describe, expect, it } from "vitest";

import { normalizeBasePath, withBasePath } from "./basePath";

describe("normalizeBasePath", () => {
	it("returns empty for root values", () => {
		expect(normalizeBasePath("")).toBe("");
		expect(normalizeBasePath("/")).toBe("");
		expect(normalizeBasePath("   ")).toBe("");
	});

	it("normalizes trailing slashes and missing leading slash", () => {
		expect(normalizeBasePath("bifrost/")).toBe("/bifrost");
		expect(normalizeBasePath("/bifrost/")).toBe("/bifrost");
	});
});

describe("withBasePath", () => {
	it("prefixes endpoints when BIFROST_BASE_PATH is set", () => {
		process.env.BIFROST_BASE_PATH = "/bifrost";
		expect(withBasePath("/api")).toBe("/bifrost/api");
	});

	it("leaves endpoints unchanged at site root", () => {
		process.env.BIFROST_BASE_PATH = "";
		expect(withBasePath("/api")).toBe("/api");
	});
});

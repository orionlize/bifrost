import { describe, expect, it } from "vitest";

import { normalizeBasePath, stripBasePath, withBasePath } from "./basePath";

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

describe("stripBasePath", () => {
	it("removes the configured base path prefix", () => {
		process.env.BIFROST_BASE_PATH = "/bifrost";
		expect(stripBasePath("/bifrost/login")).toBe("/login");
	});

	it("leaves paths unchanged at site root", () => {
		process.env.BIFROST_BASE_PATH = "";
		expect(stripBasePath("/login")).toBe("/login");
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

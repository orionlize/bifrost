import { afterEach, describe, expect, it } from "vitest";

import { getExampleBaseUrl } from "./port";

describe("getExampleBaseUrl", () => {
	const originalNodeEnv = process.env.NODE_ENV;
	const originalPort = process.env.BIFROST_PORT;
	const originalBasePath = process.env.BIFROST_BASE_PATH;

	afterEach(() => {
		process.env.NODE_ENV = originalNodeEnv;
		process.env.BIFROST_PORT = originalPort;
		process.env.BIFROST_BASE_PATH = originalBasePath;
	});

	it("includes deployment base path in development", () => {
		process.env.NODE_ENV = "development";
		process.env.BIFROST_PORT = "8080";
		process.env.BIFROST_BASE_PATH = "/bifrost";

		expect(getExampleBaseUrl()).toBe("http://localhost:8080/bifrost");
	});

	it("leaves host-only URL unchanged at site root", () => {
		process.env.NODE_ENV = "development";
		process.env.BIFROST_PORT = "8080";
		process.env.BIFROST_BASE_PATH = "";

		expect(getExampleBaseUrl()).toBe("http://localhost:8080");
	});
});

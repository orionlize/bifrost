import { describe, expect, it } from "vitest";

import { buildCurlExample, getModelIntegrationGuide } from "./providerIntegration";

describe("buildCurlExample", () => {
	it("includes integration and deployment path prefixes", () => {
		const guide = getModelIntegrationGuide("gpt-4o-mini", "openai", "bf-ak-test");
		const curl = buildCurlExample("https://example.com/bifrost", guide);

		expect(curl).toContain("https://example.com/bifrost/openai/v1/chat/completions");
		expect(curl).toContain('"model": "gpt-4o-mini"');
		expect(curl).toContain("x-api-key: bf-ak-test");
		expect(curl).not.toContain("Authorization: Bearer");
	});
});
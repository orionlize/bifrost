import { describe, expect, it } from "vitest";
import { formatTokenCount } from "./numbers";

describe("formatTokenCount", () => {
	it("shows raw counts below 1K", () => {
		expect(formatTokenCount(0)).toBe("0");
		expect(formatTokenCount(500)).toBe("500");
		expect(formatTokenCount(999)).toBe("999");
	});

	it("shows K for sub-million usage", () => {
		expect(formatTokenCount(1_500)).toBe("1.5K");
		expect(formatTokenCount(50_000)).toBe("50K");
		expect(formatTokenCount(950_000)).toBe("950K");
	});

	it("shows M for million-scale limits", () => {
		expect(formatTokenCount(1_000_000)).toBe("1M");
		expect(formatTokenCount(5_000_000)).toBe("5M");
		expect(formatTokenCount(1_250_000)).toBe("1.25M");
	});
});

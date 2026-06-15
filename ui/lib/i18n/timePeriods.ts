import type { TranslateFn } from "./context";

const PERIOD_VALUES = ["1h", "6h", "24h", "7d", "30d"] as const;

export function getLocalizedTimePeriods(t: TranslateFn): { label: string; value: string }[] {
	return PERIOD_VALUES.map((value) => ({
		value,
		label: t(`dashboard.timePeriods.${value}`),
	}));
}
export const COMPACT_NUMBER_FORMAT = {
	notation: "compact",
	compactDisplay: "short",
	maximumFractionDigits: 2,
} as const;

const TOKENS_PER_M = 1_000_000;
const TOKENS_PER_K = 1_000;

/** Formats raw token counts for governance windows (adaptive K/M/full). */
export function formatTokenCount(tokens: number): string {
	if (!Number.isFinite(tokens) || tokens <= 0) return "0";
	if (tokens >= TOKENS_PER_M) {
		const millions = tokens / TOKENS_PER_M;
		if (Number.isInteger(millions)) return `${millions}M`;
		return `${millions.toFixed(2).replace(/\.?0+$/, "")}M`;
	}
	if (tokens >= TOKENS_PER_K) {
		const thousands = tokens / TOKENS_PER_K;
		if (Number.isInteger(thousands)) return `${thousands}K`;
		return `${thousands.toFixed(1).replace(/\.?0+$/, "")}K`;
	}
	return tokens.toLocaleString("en-US");
}

export function formatCompactNumber(value: number, maximumFractionDigits = 2): string {
	if (!Number.isFinite(value)) return "0";
	return new Intl.NumberFormat("en-US", {
		...COMPACT_NUMBER_FORMAT,
		maximumFractionDigits,
	}).format(value);
}

export function formatCurrencyNumber(value: number, maximumFractionDigits = 2): string {
	if (!Number.isFinite(value)) return "$0";
	if (value !== 0 && Math.abs(value) < 0.01) {
		return `$${value.toFixed(4)}`;
	}
	return new Intl.NumberFormat("en-US", {
		...COMPACT_NUMBER_FORMAT,
		style: "currency",
		currency: "USD",
		maximumFractionDigits,
	}).format(value);
}
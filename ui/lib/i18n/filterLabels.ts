import { RequestTypeLabels, RoutingEngineUsedLabels } from "@/lib/constants/logs";
import type { TranslateFn } from "./context";

export function logStatusFilterLabel(t: TranslateFn, status: string): string {
	const key = `logsFilters.statusValues.${status}`;
	const translated = t(key);
	return translated === key ? status : translated;
}

export function mcpStatusFilterLabel(t: TranslateFn, status: string): string {
	const key = `mcpFilters.statusValues.${status}`;
	const translated = t(key);
	return translated === key ? status : translated;
}

export function logRequestTypeFilterLabel(t: TranslateFn, type: string): string {
	const key = `logsFilters.requestTypes.${type}`;
	const translated = t(key);
	if (translated !== key) {
		return translated;
	}
	return RequestTypeLabels[type as keyof typeof RequestTypeLabels] ?? type;
}

export function routingEngineFilterLabel(t: TranslateFn, engine: string): string {
	const key = `logsFilters.routingEngines.${engine}`;
	const translated = t(key);
	if (translated !== key) {
		return translated;
	}
	return RoutingEngineUsedLabels[engine as keyof typeof RoutingEngineUsedLabels] ?? engine;
}

export function aoneUserStatusLabel(t: TranslateFn, status: string | undefined): string {
	if (!status) {
		return t("aone.statusUnknown");
	}
	const key = `aone.statusValues.${status}`;
	const translated = t(key);
	return translated === key ? status : translated;
}
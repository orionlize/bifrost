export const TAURI_UPDATE_METADATA_KEY = "tauri_update";

export interface TauriUpdatePlatform {
	url: string;
	signature: string;
}

export interface TauriUpdateConfig {
	version: string;
	notes?: string;
	pub_date?: string;
	platforms?: Record<string, TauriUpdatePlatform>;
}

export const DEFAULT_TAURI_PLATFORMS = [
	"darwin-aarch64",
	"darwin-x86_64",
	"linux-x86_64",
	"linux-aarch64",
	"windows-x86_64",
	"windows-aarch64",
] as const;

export const DefaultTauriUpdateConfig: TauriUpdateConfig = {
	version: "",
	notes: "",
	pub_date: "",
	platforms: Object.fromEntries(DEFAULT_TAURI_PLATFORMS.map((key) => [key, { url: "", signature: "" }])),
};

export function parseTauriUpdateConfig(value: unknown): TauriUpdateConfig {
	const base = cloneTauriUpdateConfig(DefaultTauriUpdateConfig);
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		return base;
	}
	const raw = value as Record<string, unknown>;
	if (typeof raw.version === "string") {
		base.version = raw.version;
	}
	if (typeof raw.notes === "string") {
		base.notes = raw.notes;
	}
	if (typeof raw.pub_date === "string") {
		base.pub_date = raw.pub_date;
	}
	if (raw.platforms && typeof raw.platforms === "object" && !Array.isArray(raw.platforms)) {
		for (const key of DEFAULT_TAURI_PLATFORMS) {
			const platform = (raw.platforms as Record<string, unknown>)[key];
			if (!platform || typeof platform !== "object" || Array.isArray(platform)) {
				continue;
			}
			const entry = platform as Record<string, unknown>;
			base.platforms![key] = {
				url: typeof entry.url === "string" ? entry.url : "",
				signature: typeof entry.signature === "string" ? entry.signature : "",
			};
		}
	}
	return base;
}

export function tauriUpdateConfigFromMetadata(metadata: Record<string, unknown> | undefined): TauriUpdateConfig {
	return parseTauriUpdateConfig(metadata?.[TAURI_UPDATE_METADATA_KEY]);
}

export function cloneTauriUpdateConfig(config: TauriUpdateConfig): TauriUpdateConfig {
	return {
		version: config.version ?? "",
		notes: config.notes ?? "",
		pub_date: config.pub_date ?? "",
		platforms: Object.fromEntries(
			DEFAULT_TAURI_PLATFORMS.map((key) => [
				key,
				{
					url: config.platforms?.[key]?.url ?? "",
					signature: config.platforms?.[key]?.signature ?? "",
				},
			]),
		),
	};
}

export function tauriUpdateConfigEqual(a: TauriUpdateConfig, b: TauriUpdateConfig): boolean {
	if ((a.version ?? "") !== (b.version ?? "")) return false;
	if ((a.notes ?? "") !== (b.notes ?? "")) return false;
	if ((a.pub_date ?? "") !== (b.pub_date ?? "")) return false;
	for (const key of DEFAULT_TAURI_PLATFORMS) {
		const aPlatform = a.platforms?.[key];
		const bPlatform = b.platforms?.[key];
		if ((aPlatform?.url ?? "") !== (bPlatform?.url ?? "")) return false;
		if ((aPlatform?.signature ?? "") !== (bPlatform?.signature ?? "")) return false;
	}
	return true;
}

export function normalizeTauriUpdateConfig(config: TauriUpdateConfig): TauriUpdateConfig {
	const normalized = cloneTauriUpdateConfig(config);
	normalized.version = normalized.version.trim();
	normalized.notes = normalized.notes?.trim() ?? "";
	normalized.pub_date = normalized.pub_date?.trim() ?? "";
	for (const key of DEFAULT_TAURI_PLATFORMS) {
		const platform = normalized.platforms![key];
		platform.url = platform.url.trim();
		platform.signature = platform.signature.trim();
	}
	return normalized;
}

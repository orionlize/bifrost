import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/lib/i18n";
import { getErrorMessage, useGetTauriUpdateConfigQuery, useUpdateTauriUpdateConfigMutation } from "@/lib/store";
import {
	cloneTauriUpdateConfig,
	DEFAULT_TAURI_PLATFORMS,
	DefaultTauriUpdateConfig,
	normalizeTauriUpdateConfig,
	tauriUpdateConfigEqual,
	type TauriUpdateConfig,
} from "@/lib/types/tauriUpdate";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function isValidOptionalUrl(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return true;
	try {
		const url = new URL(trimmed);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

export default function TauriUpdateSettingsSection() {
	const t = useT();
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data, isLoading: isConfigLoading } = useGetTauriUpdateConfigQuery();
	const [updateConfig, { isLoading: isSaving }] = useUpdateTauriUpdateConfigMutation();
	const serverConfig = data?.tauri_update;
	const [localConfig, setLocalConfig] = useState<TauriUpdateConfig>(DefaultTauriUpdateConfig);

	useEffect(() => {
		if (serverConfig) {
			setLocalConfig(cloneTauriUpdateConfig(serverConfig));
		}
	}, [serverConfig]);

	const hasChanges = useMemo(() => {
		if (!serverConfig) return false;
		return !tauriUpdateConfigEqual(localConfig, serverConfig);
	}, [localConfig, serverConfig]);

	const updateField = (field: keyof TauriUpdateConfig, value: string) => {
		setLocalConfig((prev) => ({ ...prev, [field]: value }));
	};

	const updatePlatformField = (platform: string, field: "url" | "signature", value: string) => {
		setLocalConfig((prev) => ({
			...prev,
			platforms: {
				...prev.platforms,
				[platform]: {
					url: prev.platforms?.[platform]?.url ?? "",
					signature: prev.platforms?.[platform]?.signature ?? "",
					[field]: value,
				},
			},
		}));
	};

	const handleSave = async () => {
		const normalized = normalizeTauriUpdateConfig(localConfig);
		if (normalized.version) {
			for (const key of DEFAULT_TAURI_PLATFORMS) {
				const platform = normalized.platforms?.[key];
				if (!platform) continue;
				const hasUrl = !!platform.url;
				const hasSignature = !!platform.signature;
				if (hasUrl !== hasSignature) {
					toast.error(t("configViews.clientSettings.tauriUpdate.platformPairRequired", { platform: key }));
					return;
				}
				if (hasUrl && !isValidOptionalUrl(platform.url)) {
					toast.error(t("configViews.clientSettings.tauriUpdate.invalidUrlForPlatform", { platform: key }));
					return;
				}
			}
			const hasAnyPlatform = DEFAULT_TAURI_PLATFORMS.some((key) => {
				const platform = normalized.platforms?.[key];
				return !!platform?.url && !!platform?.signature;
			});
			if (!hasAnyPlatform) {
				toast.error(t("configViews.clientSettings.tauriUpdate.platformRequired"));
				return;
			}
		}

		try {
			await updateConfig(normalized).unwrap();
			toast.success(t("configViews.clientSettings.tauriUpdate.saved"));
		} catch (error) {
			toast.error(getErrorMessage(error));
		}
	};

	return (
		<div className="bg-muted/20 space-y-4 rounded-xl border p-5">
			<div>
				<h3 className="text-lg font-semibold tracking-tight">{t("configViews.clientSettings.tauriUpdate.title")}</h3>
				<p className="text-muted-foreground text-sm">{t("configViews.clientSettings.tauriUpdate.description")}</p>
			</div>

			<div className="grid gap-4 md:grid-cols-2">
				<div>
					<Label className="text-sm">{t("configViews.clientSettings.tauriUpdate.version")}</Label>
					<Input
						className="mt-1.5"
						placeholder="0.2.0"
						value={localConfig.version}
						onChange={(e) => updateField("version", e.target.value)}
						disabled={!hasSettingsUpdateAccess}
						data-testid="tauri-update-version"
					/>
				</div>
				<div>
					<Label className="text-sm">{t("configViews.clientSettings.tauriUpdate.pubDate")}</Label>
					<Input
						className="mt-1.5"
						placeholder="2026-06-06T12:00:00Z"
						value={localConfig.pub_date ?? ""}
						onChange={(e) => updateField("pub_date", e.target.value)}
						disabled={!hasSettingsUpdateAccess}
						data-testid="tauri-update-pub-date"
					/>
				</div>
			</div>

			<div>
				<Label className="text-sm">{t("configViews.clientSettings.tauriUpdate.notes")}</Label>
				<Textarea
					className="mt-1.5 min-h-24"
					placeholder={t("configViews.clientSettings.tauriUpdate.notesPlaceholder")}
					value={localConfig.notes ?? ""}
					onChange={(e) => updateField("notes", e.target.value)}
					disabled={!hasSettingsUpdateAccess}
					data-testid="tauri-update-notes"
				/>
			</div>

			<div className="space-y-3">
				<div>
					<h4 className="text-sm font-medium">{t("configViews.clientSettings.tauriUpdate.platformsTitle")}</h4>
					<p className="text-muted-foreground text-xs">{t("configViews.clientSettings.tauriUpdate.platformsHint")}</p>
				</div>
				<div className="space-y-4">
					{DEFAULT_TAURI_PLATFORMS.map((platform) => (
						<div key={platform} className="bg-background grid gap-3 rounded-lg border p-4 md:grid-cols-2">
							<div className="md:col-span-2">
								<p className="font-mono text-xs font-medium">{platform}</p>
							</div>
							<div>
								<Label className="text-xs">{t("configViews.clientSettings.tauriUpdate.installerUrl")}</Label>
								<Input
									className="mt-1.5 font-mono text-xs"
									placeholder="https://cdn.example.com/zwitch-0.2.0.app.tar.gz"
									value={localConfig.platforms?.[platform]?.url ?? ""}
									onChange={(e) => updatePlatformField(platform, "url", e.target.value)}
									disabled={!hasSettingsUpdateAccess}
									data-testid={`tauri-update-platform-url-${platform}`}
								/>
							</div>
							<div>
								<Label className="text-xs">{t("configViews.clientSettings.tauriUpdate.signature")}</Label>
								<Input
									className="mt-1.5 font-mono text-xs"
									placeholder={t("configViews.clientSettings.tauriUpdate.signaturePlaceholder")}
									value={localConfig.platforms?.[platform]?.signature ?? ""}
									onChange={(e) => updatePlatformField(platform, "signature", e.target.value)}
									disabled={!hasSettingsUpdateAccess}
									data-testid={`tauri-update-platform-signature-${platform}`}
								/>
							</div>
						</div>
					))}
				</div>
			</div>

			<div className="flex justify-end pt-2">
				<Button
					onClick={handleSave}
					disabled={!hasChanges || isSaving || isConfigLoading || !hasSettingsUpdateAccess}
					data-testid="tauri-update-save"
				>
					{isSaving ? t("common.actions.saving") : t("common.actions.saveChanges")}
				</Button>
			</div>
		</div>
	);
}
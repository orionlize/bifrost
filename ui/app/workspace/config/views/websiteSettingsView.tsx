import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, useGetCoreConfigQuery, useUpdateClientMetadataMutation } from "@/lib/store";
import { websiteBrandingDefaults } from "@/lib/hooks/useWebsiteBranding";
import {
	DefaultWebsiteConfig,
	normalizeWebsiteConfig,
	WEBSITE_METADATA_KEY,
	websiteConfigEqual,
	websiteConfigFromMetadata,
	type WebsiteConfig,
} from "@/lib/types/websiteConfig";
import { RbacOperation, RbacResource, useRbac } from "@enterprise/lib";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

function isValidOptionalUrl(value: string): boolean {
	const trimmed = value.trim();
	if (!trimmed) return true;
	if (trimmed.startsWith("/")) return true;
	try {
		const url = new URL(trimmed);
		return url.protocol === "http:" || url.protocol === "https:";
	} catch {
		return false;
	}
}

function resolvePreviewIcon(config: WebsiteConfig): string {
	return config.icon_url?.trim() || websiteBrandingDefaults.iconLight;
}

function BrandPreview({ config, variant }: { config: WebsiteConfig; variant: "expanded" | "collapsed" }) {
	const siteName = config.name?.trim() || "Bifrost";
	const iconSrc = resolvePreviewIcon(config);

	if (variant === "collapsed") {
		return (
			<div className="bg-sidebar flex w-16 flex-col items-center gap-2 rounded-md border py-3">
				<img className="h-[22px] w-auto" src={iconSrc} alt={siteName} width={22} height={22} style={{ width: 18 }} />
			</div>
		);
	}

	return (
		<div className="bg-sidebar flex items-center gap-2 rounded-md border px-3 py-2">
			<img className="h-[22px] w-auto shrink-0" src={iconSrc} alt={siteName} width={22} height={22} />
			<span className="text-sm font-medium">{siteName}</span>
		</div>
	);
}

export default function WebsiteSettingsView() {
	const hasSettingsUpdateAccess = useRbac(RbacResource.Settings, RbacOperation.Update);
	const { data: bifrostConfig, isLoading: isConfigLoading } = useGetCoreConfigQuery({ fromDB: true });
	const [updateClientMetadata, { isLoading: isSaving }] = useUpdateClientMetadataMutation();
	const serverConfig = useMemo(
		() => websiteConfigFromMetadata(bifrostConfig?.metadata as Record<string, unknown> | undefined),
		[bifrostConfig?.metadata],
	);
	const [localConfig, setLocalConfig] = useState<WebsiteConfig>(DefaultWebsiteConfig);

	useEffect(() => {
		setLocalConfig(serverConfig);
	}, [serverConfig]);

	const hasChanges = useMemo(() => !websiteConfigEqual(localConfig, serverConfig), [localConfig, serverConfig]);

	const updateField = useCallback((field: keyof WebsiteConfig, value: string) => {
		setLocalConfig((prev) => ({ ...prev, [field]: value }));
	}, []);

	const handleSave = async () => {
		for (const field of ["icon_url", "icon_dark_url"] as const) {
			const value = localConfig[field] ?? "";
			if (!isValidOptionalUrl(value)) {
				toast.error(`Invalid URL for ${field.replace(/_/g, " ")}`);
				return;
			}
		}

		try {
			const normalized = normalizeWebsiteConfig(localConfig);
			await updateClientMetadata({ [WEBSITE_METADATA_KEY]: normalized }).unwrap();
			toast.success("Website settings saved");
		} catch (err) {
			toast.error(getErrorMessage(err));
		}
	};

	const handleReset = () => {
		setLocalConfig(serverConfig);
	};

	return (
		<div className="flex w-full flex-col gap-6 py-6">
			<header className="space-y-1">
				<h2 className="flex flex-row items-center gap-1 text-lg font-semibold tracking-tight">
					<LayoutTemplate className="size-4" />
					Website
				</h2>
				<p className="text-muted-foreground text-sm">
					Customize the site name and icon shown in the sidebar. One icon is used for both expanded and collapsed layouts. Leave fields
					empty to use the default Bifrost assets.
				</p>
			</header>

			{isConfigLoading ? (
				<p className="text-muted-foreground text-sm">Loading website settings...</p>
			) : (
				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
					<div className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="website-name">Site name</Label>
							<Input
								id="website-name"
								value={localConfig.name ?? ""}
								onChange={(e) => updateField("name", e.target.value)}
								placeholder="Bifrost"
								disabled={!hasSettingsUpdateAccess}
								data-testid="website-name-input"
							/>
							<p className="text-muted-foreground text-xs">Shown next to the icon in the expanded sidebar and used for image alt text.</p>
						</div>

						<div className="space-y-4 rounded-md border p-4">
							<h3 className="text-sm font-medium">Sidebar icon</h3>
							<p className="text-muted-foreground text-xs">Used in both expanded and collapsed sidebar states.</p>
							<div className="space-y-2">
								<Label htmlFor="website-icon-url">Icon URL (light)</Label>
								<Input
									id="website-icon-url"
									value={localConfig.icon_url ?? ""}
									onChange={(e) => updateField("icon_url", e.target.value)}
									placeholder={websiteBrandingDefaults.iconLight}
									disabled={!hasSettingsUpdateAccess}
									data-testid="website-icon-url-input"
								/>
							</div>
							<div className="space-y-2">
								<Label htmlFor="website-icon-dark-url">Icon URL (dark, optional)</Label>
								<Input
									id="website-icon-dark-url"
									value={localConfig.icon_dark_url ?? ""}
									onChange={(e) => updateField("icon_dark_url", e.target.value)}
									placeholder={websiteBrandingDefaults.iconDark}
									disabled={!hasSettingsUpdateAccess}
									data-testid="website-icon-dark-url-input"
								/>
							</div>
						</div>

						<div className="flex items-center gap-2">
							<Button
								onClick={handleSave}
								disabled={!hasSettingsUpdateAccess || !hasChanges || isSaving}
								data-testid="website-settings-save-btn"
							>
								{isSaving && <Loader2 className="mr-2 size-4 animate-spin" />}
								Save changes
							</Button>
							<Button variant="outline" onClick={handleReset} disabled={!hasChanges || isSaving}>
								Reset
							</Button>
						</div>
					</div>

					<div className="space-y-4">
						<p className="text-muted-foreground text-xs font-medium uppercase tracking-wide">Preview</p>
						<div className="space-y-3">
							<div className="space-y-2">
								<p className="text-muted-foreground text-xs">Expanded</p>
								<BrandPreview config={localConfig} variant="expanded" />
							</div>
							<div className="space-y-2">
								<p className="text-muted-foreground text-xs">Collapsed</p>
								<BrandPreview config={localConfig} variant="collapsed" />
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

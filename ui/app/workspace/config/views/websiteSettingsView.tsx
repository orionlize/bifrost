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
import { useT } from "@/lib/i18n";
import { useNavDescription, useNavTitle } from "@/lib/i18n/useNavTitle";
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
	const t = useT();
	const pageTitle = useNavTitle("website");
	const pageDescription = useNavDescription("website");
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
				toast.error(t("configViews.website.invalidUrlForField", { field: field.replace(/_/g, " ") }));
				return;
			}
		}

		try {
			const normalized = normalizeWebsiteConfig(localConfig);
			await updateClientMetadata({ [WEBSITE_METADATA_KEY]: normalized }).unwrap();
			toast.success(t("configViews.website.saved"));
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
					{pageTitle}
				</h2>
				<p className="text-muted-foreground text-sm">{pageDescription}</p>
			</header>

			{isConfigLoading ? (
				<p className="text-muted-foreground text-sm">{t("configPages.loadingWebsiteSettings")}</p>
			) : (
				<div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_240px]">
					<div className="space-y-6">
						<div className="space-y-2">
							<Label htmlFor="website-name">{t("configViews.website.siteName")}</Label>
							<Input
								id="website-name"
								value={localConfig.name ?? ""}
								onChange={(e) => updateField("name", e.target.value)}
								placeholder={t("configViews.website.siteNamePlaceholder")}
								disabled={!hasSettingsUpdateAccess}
								data-testid="website-name-input"
							/>
							<p className="text-muted-foreground text-xs">{t("configViews.website.siteNameHint")}</p>
						</div>

						<div className="space-y-4 rounded-md border p-4">
							<h3 className="text-sm font-medium">{t("configViews.website.sidebarIcon")}</h3>
							<p className="text-muted-foreground text-xs">{t("configViews.website.sidebarIconHint")}</p>
							<div className="space-y-2">
								<Label htmlFor="website-icon-url">{t("configViews.website.iconUrlLight")}</Label>
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
								<Label htmlFor="website-icon-dark-url">{t("configViews.website.iconUrlDark")}</Label>
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
								{t("common.actions.saveChanges")}
							</Button>
							<Button variant="outline" onClick={handleReset} disabled={!hasChanges || isSaving}>
								{t("configViews.shared.reset")}
							</Button>
						</div>
					</div>

					<div className="space-y-4">
						<p className="text-muted-foreground text-xs font-medium tracking-wide uppercase">{t("configViews.website.preview")}</p>
						<div className="space-y-3">
							<div className="space-y-2">
								<p className="text-muted-foreground text-xs">{t("configViews.website.expanded")}</p>
								<BrandPreview config={localConfig} variant="expanded" />
							</div>
							<div className="space-y-2">
								<p className="text-muted-foreground text-xs">{t("configViews.website.collapsed")}</p>
								<BrandPreview config={localConfig} variant="collapsed" />
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}

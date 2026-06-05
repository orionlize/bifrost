import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useT } from "@/lib/i18n";
import { useUpdateMarketplaceConfigMutation } from "@/lib/store/apis/marketplaceApi";
import { MarketplaceConfig } from "@/lib/types/marketplace";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MarketplaceCatalogSourcesSection } from "./marketplaceCatalogSourcesSection";
import { MarketplaceGitCredentialsSection } from "./marketplaceGitCredentialsSection";

export function MarketplaceSettingsPanel({
	claudeManifestURL,
	codexManifestURL,
	config,
	isAdmin = false,
	embedded = false,
}: {
	claudeManifestURL: string;
	codexManifestURL: string;
	config?: MarketplaceConfig;
	isAdmin?: boolean;
	embedded?: boolean;
}) {
	const t = useT();
	const [updateConfig, { isLoading: isSavingPublish }] = useUpdateMarketplaceConfigMutation();
	const [catalogName, setCatalogName] = useState("");
	const [ownerName, setOwnerName] = useState("");
	const [publicRead, setPublicRead] = useState(true);

	useEffect(() => {
		if (!config) return;
		setCatalogName(config.name);
		setOwnerName(config.owner?.name ?? "");
		setPublicRead(config.public_read ?? true);
	}, [config]);

	const savePublishConfig = async () => {
		if (!config) return;
		if (!catalogName.trim()) {
			toast.error(t("marketplace.source.publishNameRequired"));
			return;
		}
		try {
			await updateConfig({
				...config,
				name: catalogName.trim(),
				owner: { ...config.owner, name: ownerName.trim() },
				public_read: publicRead,
			}).unwrap();
			toast.success(t("marketplace.source.configUpdated"));
		} catch {
			toast.error(t("marketplace.toast.updateFailed"));
		}
	};

	const content = (
		<div className="max-w-3xl space-y-6">
			<MarketplaceGitCredentialsSection />

			{isAdmin && config && (
				<>
					<MarketplaceCatalogSourcesSection config={config} />

					<div className="space-y-4 rounded-xl border bg-muted/20 p-5">
						<div>
							<h3 className="text-[15px] font-semibold">{t("marketplace.source.publishTitle")}</h3>
							<p className="text-muted-foreground mt-1 text-[13px]">{t("marketplace.source.publishDescription")}</p>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<Label className="text-[13px]">{t("marketplace.source.claudeManifest")}</Label>
								<Input
									readOnly
									value={claudeManifestURL}
									className="mt-1.5 bg-background"
									data-testid="marketplace-manifest-url-claude"
								/>
								<p className="text-muted-foreground mt-1 text-[11px]">{t("marketplace.source.claudeManifestHint")}</p>
							</div>
							<div>
								<Label className="text-[13px]">{t("marketplace.source.codexManifest")}</Label>
								<Input
									readOnly
									value={codexManifestURL}
									className="mt-1.5 bg-background"
									data-testid="marketplace-manifest-url-codex"
								/>
								<p className="text-muted-foreground mt-1 text-[11px]">{t("marketplace.source.codexManifestHint")}</p>
							</div>
						</div>
						<div className="grid gap-4 md:grid-cols-2">
							<div>
								<Label className="text-[13px]">{t("marketplace.source.name")}</Label>
								<Input
									className="mt-1.5 bg-background"
									value={catalogName}
									onChange={(e) => setCatalogName(e.target.value)}
									data-testid="marketplace-config-name"
								/>
							</div>
							<div>
								<Label className="text-[13px]">{t("marketplace.source.owner")}</Label>
								<Input
									className="mt-1.5 bg-background"
									value={ownerName}
									onChange={(e) => setOwnerName(e.target.value)}
									data-testid="marketplace-config-owner"
								/>
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Switch
								checked={publicRead}
								onCheckedChange={setPublicRead}
								data-testid="marketplace-config-public-read"
							/>
							<Label className="text-[13px]">{t("marketplace.source.publicCatalog")}</Label>
						</div>
						<div className="flex justify-end">
							<Button
								type="button"
								size="sm"
								onClick={savePublishConfig}
								disabled={isSavingPublish}
								data-testid="marketplace-save-publish-config"
							>
								{isSavingPublish ? t("common.actions.saving") : t("common.actions.save")}
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);

	if (embedded) {
		return content;
	}

	return <div className="rounded-2xl border bg-muted/30 p-4">{content}</div>;
}

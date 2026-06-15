import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";
import { useGetMarketplaceGitCredentialsQuery, useUpdateMarketplaceGitCredentialsMutation } from "@/lib/store/apis/marketplaceApi";
import { useState } from "react";
import { toast } from "sonner";

export function MarketplaceGitCredentialsSection() {
	const t = useT();
	const { data, isLoading } = useGetMarketplaceGitCredentialsQuery();
	const [updateCredentials, { isLoading: isSaving }] = useUpdateMarketplaceGitCredentialsMutation();

	const [githubToken, setGithubToken] = useState("");
	const [gitlabToken, setGitlabToken] = useState("");

	const status = data?.git_credentials;
	const githubConfigured = status?.github_token_configured ?? false;
	const gitlabConfigured = status?.gitlab_token_configured ?? false;

	const save = async () => {
		const body: { github_token?: string; gitlab_token?: string } = {};
		if (githubToken.trim()) {
			body.github_token = githubToken.trim();
		}
		if (gitlabToken.trim()) {
			body.gitlab_token = gitlabToken.trim();
		}
		if (!body.github_token && !body.gitlab_token) {
			toast.error(t("marketplace.gitCredentials.nothingToSave"));
			return;
		}
		try {
			await updateCredentials(body).unwrap();
			setGithubToken("");
			setGitlabToken("");
			toast.success(t("marketplace.gitCredentials.saved"));
		} catch {
			toast.error(t("marketplace.toast.updateFailed"));
		}
	};

	const clearToken = async (field: "github_token" | "gitlab_token") => {
		try {
			await updateCredentials({ [field]: "" }).unwrap();
			toast.success(t("marketplace.gitCredentials.cleared"));
		} catch {
			toast.error(t("marketplace.toast.updateFailed"));
		}
	};

	return (
		<div className="bg-muted/20 space-y-4 rounded-xl border p-5" data-testid="marketplace-git-credentials-section">
			<div>
				<h3 className="text-[15px] font-semibold">{t("marketplace.gitCredentials.title")}</h3>
				<p className="text-muted-foreground mt-1 text-[13px]">{t("marketplace.gitCredentials.description")}</p>
			</div>

			{isLoading ? (
				<p className="text-muted-foreground text-[13px]">{t("marketplace.loading")}</p>
			) : (
				<div className="grid gap-4 md:grid-cols-2">
					<div className="space-y-2">
						<Label className="text-[13px]">{t("marketplace.gitCredentials.githubToken")}</Label>
						<Input
							type="password"
							value={githubToken}
							onChange={(e) => setGithubToken(e.target.value)}
							placeholder={
								githubConfigured ? t("marketplace.gitCredentials.configuredPlaceholder") : t("marketplace.gitCredentials.githubPlaceholder")
							}
							autoComplete="off"
							data-testid="marketplace-github-token"
						/>
						{githubConfigured && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs"
								onClick={() => clearToken("github_token")}
								data-testid="marketplace-clear-github-token"
							>
								{t("marketplace.gitCredentials.clear")}
							</Button>
						)}
					</div>
					<div className="space-y-2">
						<Label className="text-[13px]">{t("marketplace.gitCredentials.gitlabToken")}</Label>
						<Input
							type="password"
							value={gitlabToken}
							onChange={(e) => setGitlabToken(e.target.value)}
							placeholder={
								gitlabConfigured ? t("marketplace.gitCredentials.configuredPlaceholder") : t("marketplace.gitCredentials.gitlabPlaceholder")
							}
							autoComplete="off"
							data-testid="marketplace-gitlab-token"
						/>
						{gitlabConfigured && (
							<Button
								type="button"
								variant="ghost"
								size="sm"
								className="h-7 px-2 text-xs"
								onClick={() => clearToken("gitlab_token")}
								data-testid="marketplace-clear-gitlab-token"
							>
								{t("marketplace.gitCredentials.clear")}
							</Button>
						)}
					</div>
				</div>
			)}

			<div className="flex justify-end">
				<Button type="button" size="sm" onClick={save} disabled={isSaving} data-testid="marketplace-save-git-credentials">
					{t("marketplace.gitCredentials.save")}
				</Button>
			</div>
		</div>
	);
}
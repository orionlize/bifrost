import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useT } from "@/lib/i18n";
import type { GlobalApiKey } from "@/lib/store/apis/globalApiKeysApi";
import { formatGlobalApiKeyLabel } from "@/lib/utils/globalApiKeyStorage";
import { KeyRound } from "lucide-react";

interface ApiKeySelectProps {
	apiKeys: GlobalApiKey[];
	selectedKeyId: string;
	onSelect: (keyId: string) => void;
}

export function ApiKeySelect({ apiKeys, selectedKeyId, onSelect }: ApiKeySelectProps) {
	const t = useT();
	const selectedKey = apiKeys.find((key) => key.id === selectedKeyId);

	return (
		<div className="space-y-2">
			<Label htmlFor="quick-start-api-key-select" className="flex items-center gap-2">
				<KeyRound className="size-4" />
				{t("quickStart.apiKeyLabel")}
			</Label>
			<Select value={selectedKeyId || undefined} onValueChange={onSelect}>
				<SelectTrigger id="quick-start-api-key-select" className="w-full" data-testid="quick-start-api-key-select">
					<SelectValue placeholder={t("quickStart.apiKeyPlaceholder")}>
						{selectedKey ? formatGlobalApiKeyLabel(selectedKey.name, selectedKey.token_prefix) : null}
					</SelectValue>
				</SelectTrigger>
				<SelectContent>
					{apiKeys.map((apiKey) => (
						<SelectItem key={apiKey.id} value={apiKey.id} data-testid={`quick-start-api-key-option-${apiKey.id}`}>
							{formatGlobalApiKeyLabel(apiKey.name, apiKey.token_prefix)}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
			<p className="text-muted-foreground text-xs">{t("quickStart.apiKeySelectHint")}</p>
		</div>
	);
}
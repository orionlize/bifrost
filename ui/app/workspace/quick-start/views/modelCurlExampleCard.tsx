import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/codeEditor";
import { Label } from "@/components/ui/label";
import { ModelMultiselect } from "@/components/ui/modelMultiselect";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { useT } from "@/lib/i18n";
import { useGetAllKeysQuery, useGetModelsQuery } from "@/lib/store";
import { isFullGlobalApiKeyToken } from "@/lib/utils/globalApiKeyStorage";
import { buildCurlExample, getModelIntegrationGuide } from "@/lib/utils/providerIntegration";
import { resolveQuickStartModelPickerOptions } from "@/lib/utils/providerModelPickerOptions";
import { Copy } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

const EditorOptions = {
	scrollBeyondLastLine: false,
	minimap: { enabled: false },
	lineNumbers: "off" as const,
	folding: false,
	lineDecorationsWidth: 0,
	lineNumbersMinChars: 0,
	glyphMargin: false,
};

interface ModelCurlExampleCardProps {
	baseUrl: string;
	apiKey: string;
	selectedKeyId: string;
	isApiKeyLoading?: boolean;
}

export function ModelCurlExampleCard({ baseUrl, apiKey, selectedKeyId, isApiKeyLoading = false }: ModelCurlExampleCardProps) {
	const t = useT();
	const [selectedModel, setSelectedModel] = useState("");
	const { copy: copyToClipboard } = useCopyToClipboard();
	const { data: allKeys = [] } = useGetAllKeysQuery();
	const modelPickerOptions = useMemo(() => resolveQuickStartModelPickerOptions(allKeys), [allKeys]);
	const modelsQueryArgs = useMemo(
		() => ({
			keys: modelPickerOptions.keyIds,
			limit: 5000,
		}),
		[modelPickerOptions.keyIds],
	);
	const { data: modelsData } = useGetModelsQuery(modelsQueryArgs, { skip: !modelPickerOptions.keyIds?.length });

	const selectedProvider = useMemo(() => {
		if (!selectedModel) {
			return undefined;
		}
		const slashIndex = selectedModel.indexOf("/");
		if (slashIndex > 0) {
			return selectedModel.slice(0, slashIndex);
		}
		const matchedModel = modelsData?.models.find((model) => model.name === selectedModel);
		return matchedModel?.provider;
	}, [modelsData?.models, selectedModel]);

	const hasFullApiKey = isFullGlobalApiKeyToken(apiKey);

	const guide = useMemo(() => {
		if (!selectedModel || !selectedProvider) {
			return null;
		}
		return getModelIntegrationGuide(selectedModel, selectedProvider, apiKey);
	}, [apiKey, selectedModel, selectedProvider]);

	const curlExample = useMemo(() => {
		if (!guide) {
			return "";
		}
		return buildCurlExample(baseUrl, guide);
	}, [baseUrl, guide]);

	useEffect(() => {
		if (!selectedModel || !modelsData?.models) {
			return;
		}
		if (!modelsData.models.some((model) => model.name === selectedModel)) {
			setSelectedModel("");
		}
	}, [modelsData?.models, selectedModel]);

	return (
		<div className="space-y-4" data-testid="quick-start-model-curl-card">
			<div className="space-y-2">
				<Label htmlFor="quick-start-model-select">{t("quickStart.selectModel")}</Label>
				<ModelMultiselect
					isSingleSelect
					value={selectedModel}
					onChange={setSelectedModel}
					keys={modelPickerOptions.keyIds}
					extraModels={modelPickerOptions.extraModels}
					loadModelsOnEmptyProvider
					inputId="quick-start-model-select"
					data-testid="quick-start-model-select"
					placeholder={t("quickStart.selectModelPlaceholder")}
					clearable
				/>
			</div>

			{guide ? (
				<div className="space-y-3">
					{!hasFullApiKey ? (
						<p className="text-muted-foreground text-sm" data-testid="quick-start-model-curl-api-key-pending">
							{isApiKeyLoading ? t("quickStart.loadingApiKey") : t("quickStart.apiKeyUnavailable")}
						</p>
					) : null}
					<div className="grid gap-2 text-sm">
						<div>
							<span className="text-muted-foreground">{t("quickStart.baseUrl")} </span>
							<code className="text-xs">
								{baseUrl}
								{guide.pathPrefix}
							</code>
						</div>
						<div>
							<span className="text-muted-foreground">{t("quickStart.authentication")} </span>
							<code className="text-xs">{guide.authHeader}</code>
						</div>
						<div>
							<span className="text-muted-foreground">{t("quickStart.exampleModel")} </span>
							<code className="text-xs">{guide.exampleModel}</code>
						</div>
					</div>

					<div className="relative">
						<Button
							variant="ghost"
							size="icon"
							className="absolute top-2 right-2 z-10"
							onClick={() => copyToClipboard(curlExample)}
							data-testid="quick-start-copy-model-curl"
						>
							<Copy className="size-4" />
						</Button>
						<CodeEditor
							key={`${selectedKeyId}:${apiKey}:${selectedModel}`}
							className="w-full"
							code={curlExample}
							lang="shell"
							readonly
							height={240}
							fontSize={13}
							options={EditorOptions}
						/>
					</div>
				</div>
			) : (
				<p className="text-muted-foreground text-sm">{t("quickStart.selectModelHint")}</p>
			)}
		</div>
	);
}
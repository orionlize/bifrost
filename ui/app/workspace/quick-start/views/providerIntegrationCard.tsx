import { Button } from "@/components/ui/button";
import { CodeEditor } from "@/components/ui/codeEditor";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RenderProviderIcon, ProviderIconType } from "@/lib/constants/icons";
import { getProviderLabel } from "@/lib/constants/logs";
import { useT } from "@/lib/i18n";
import { isKnownProvider } from "@/lib/types/config";
import { buildCurlExample, buildSdkExample, getProviderIntegrationGuide } from "@/lib/utils/providerIntegration";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { Copy, Box } from "lucide-react";
import { useMemo, useState } from "react";

const EditorOptions = {
	scrollBeyondLastLine: false,
	minimap: { enabled: false },
	lineNumbers: "off" as const,
	folding: false,
	lineDecorationsWidth: 0,
	lineNumbersMinChars: 0,
	glyphMargin: false,
};

interface ProviderIntegrationCardProps {
	provider: string;
	baseUrl: string;
	apiKey: string;
}

export function ProviderIntegrationCard({ provider, baseUrl, apiKey }: ProviderIntegrationCardProps) {
	const t = useT();
	const [language, setLanguage] = useState<"python" | "typescript">("python");
	const { copy: copyToClipboard } = useCopyToClipboard();

	const guide = useMemo(() => getProviderIntegrationGuide(provider, apiKey), [provider, apiKey]);
	const curlExample = useMemo(() => buildCurlExample(baseUrl, guide), [baseUrl, guide]);
	const sdkExample = useMemo(() => buildSdkExample(baseUrl, guide, language, apiKey), [baseUrl, guide, language, apiKey]);

	return (
		<div className="rounded-lg border p-4" data-testid={`quick-start-provider-${provider}`}>
			<div className="mb-4 flex items-center gap-3">
				{isKnownProvider(provider) ? (
					<RenderProviderIcon provider={provider as ProviderIconType} size="sm" />
				) : (
					<Box className="size-5 shrink-0" />
				)}
				<div>
					<h3 className="font-semibold">{getProviderLabel(provider)}</h3>
					<p className="text-muted-foreground text-sm">
						{t("quickStart.baseUrl")}{" "}
						<code className="text-xs">
							{baseUrl}
							{guide.pathPrefix}
						</code>
					</p>
				</div>
			</div>

			<div className="mb-4 grid gap-2 text-sm">
				<div>
					<span className="text-muted-foreground">{t("quickStart.authentication")} </span>
					<code className="text-xs">{guide.authHeader}</code>
				</div>
				<div>
					<span className="text-muted-foreground">{t("quickStart.exampleModel")} </span>
					<code className="text-xs">{guide.exampleModel}</code>
				</div>
			</div>

			<Tabs defaultValue="curl">
				<TabsList>
					<TabsTrigger value="curl">{t("quickStart.curl")}</TabsTrigger>
					<TabsTrigger value="sdk">{t("quickStart.sdk")}</TabsTrigger>
				</TabsList>
				<TabsContent value="curl" className="mt-3">
					<div className="relative">
						<Button
							variant="ghost"
							size="icon"
							className="absolute top-2 right-2 z-10"
							onClick={() => copyToClipboard(curlExample)}
							data-testid={`quick-start-copy-curl-${provider}`}
						>
							<Copy className="size-4" />
						</Button>
						<CodeEditor className="w-full" code={curlExample} lang="shell" readonly height={220} fontSize={13} options={EditorOptions} />
					</div>
				</TabsContent>
				<TabsContent value="sdk" className="mt-3">
					<div className="relative">
						<div className="absolute top-2 right-2 z-10 flex items-center gap-2">
							<Select value={language} onValueChange={(value) => setLanguage(value as "python" | "typescript")}>
								<SelectTrigger className="h-8 w-fit text-xs">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem className="text-xs" value="python">
										{t("quickStart.python")}
									</SelectItem>
									<SelectItem className="text-xs" value="typescript">
										{t("quickStart.typescript")}
									</SelectItem>
								</SelectContent>
							</Select>
							<Button
								variant="ghost"
								size="icon"
								onClick={() => copyToClipboard(sdkExample)}
								data-testid={`quick-start-copy-sdk-${provider}`}
							>
								<Copy className="size-4" />
							</Button>
						</div>
						<CodeEditor className="w-full" code={sdkExample} lang={language} readonly height={260} fontSize={13} options={EditorOptions} />
					</div>
				</TabsContent>
			</Tabs>
		</div>
	);
}

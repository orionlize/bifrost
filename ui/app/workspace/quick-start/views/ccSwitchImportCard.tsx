import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CodeEditor } from "@/components/ui/codeEditor";
import { useCopyToClipboard } from "@/hooks/useCopyToClipboard";
import { AlertCircle, Copy, ExternalLink, LucideIcon } from "lucide-react";

const EditorOptions = {
	scrollBeyondLastLine: false,
	minimap: { enabled: false },
	lineNumbers: "off" as const,
	folding: false,
	lineDecorationsWidth: 0,
	lineNumbersMinChars: 0,
	glyphMargin: false,
};

interface CcSwitchImportCardProps {
	title: string;
	icon: LucideIcon;
	description: string;
	testId: string;
	importUrl: string;
	manualConfigLabel: string;
	manualConfig: string;
	manualConfigLanguage: "json" | "shell";
	showApiKeyWarning: boolean;
	apiKeyWarning: string;
}

export function CcSwitchImportCard({
	title,
	icon: Icon,
	description,
	testId,
	importUrl,
	manualConfigLabel,
	manualConfig,
	manualConfigLanguage,
	showApiKeyWarning,
	apiKeyWarning,
}: CcSwitchImportCardProps) {
	const { copy: copyToClipboard } = useCopyToClipboard();

	const handleImport = () => {
		window.location.href = importUrl;
	};

	return (
		<Card data-testid={testId}>
			<CardHeader>
				<CardTitle className="flex items-center gap-2">
					<Icon className="size-5" />
					{title}
				</CardTitle>
				<CardDescription>
					{description}{" "}
					<a
						href="https://github.com/farion1231/cc-switch"
						target="_blank"
						rel="noreferrer"
						className="text-primary inline-flex items-center gap-1 underline-offset-4 hover:underline"
					>
						CC Switch
						<ExternalLink className="size-3.5" />
					</a>{" "}
					first.
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{showApiKeyWarning && (
					<Alert>
						<AlertCircle className="size-4" />
						<AlertDescription>{apiKeyWarning}</AlertDescription>
					</Alert>
				)}

				<div className="flex flex-wrap gap-2">
					<Button onClick={handleImport} data-testid={`${testId}-import`}>
						Import with CC Switch
					</Button>
					<Button variant="outline" onClick={() => copyToClipboard(importUrl)} data-testid={`${testId}-copy-link`}>
						<Copy className="size-4" />
						Copy Deep Link
					</Button>
					<Button variant="outline" onClick={() => copyToClipboard(manualConfig)} data-testid={`${testId}-copy-config`}>
						<Copy className="size-4" />
						Copy manual config
					</Button>
				</div>

				<div>
					<p className="text-muted-foreground mb-2 text-sm">{manualConfigLabel}</p>
					<div className="relative">
						<Button variant="ghost" size="icon" className="absolute top-2 right-2 z-10" onClick={() => copyToClipboard(manualConfig)}>
							<Copy className="size-4" />
						</Button>
						<CodeEditor
							className="w-full"
							code={manualConfig}
							lang={manualConfigLanguage}
							readonly
							height={manualConfigLanguage === "json" ? 120 : 80}
							fontSize={13}
							options={EditorOptions}
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}
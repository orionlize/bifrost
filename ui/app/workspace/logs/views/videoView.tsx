import { ExternalLink, Video } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { BifrostVideoDownloadOutput, BifrostVideoGenerationOutput, BifrostVideoListOutput } from "@/lib/types/logs";
import { useT, type TranslateFn } from "@/lib/i18n";

import CollapsibleBox from "./collapsibleBox";
import { CodeEditor } from "@/components/ui/codeEditor";

interface VideoGenerationInput {
	prompt: string;
}

type VideoOutput = BifrostVideoGenerationOutput | BifrostVideoDownloadOutput;

interface VideoViewProps {
	videoInput?: VideoGenerationInput;
	videoOutput?: VideoOutput;
	videoListOutput?: BifrostVideoListOutput;
	requestType?: string;
}

function getMethodTypeLabel(t: TranslateFn, requestType?: string): string {
	if (!requestType) return t("logsMedia.videoDefault");
	const normalized = requestType.toLowerCase();
	if (normalized.includes("video_download")) return t("logsMedia.videoDownload");
	if (normalized.includes("video_retrieve")) return t("logsMedia.videoRetrieve");
	if (normalized.includes("video_generation")) return t("logsMedia.videoGeneration");
	if (normalized.includes("video_list")) return t("logsMedia.videoList");
	return t("logsMedia.videoGeneration");
}

export default function VideoView({ videoInput, videoOutput, videoListOutput, requestType }: VideoViewProps) {
	const t = useT();
	const methodTypeLabel = getMethodTypeLabel(t, requestType);
	const isDownload = requestType?.toLowerCase().includes("video_download");
	const downloadOutput = isDownload && videoOutput ? (videoOutput as BifrostVideoDownloadOutput) : null;
	const generationOutput = !isDownload && videoOutput ? (videoOutput as BifrostVideoGenerationOutput) : null;
	const outputURL = generationOutput?.videos?.[0]?.url;

	return (
		<div className="space-y-4">
			{videoInput && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Video className="h-4 w-4" />
						{methodTypeLabel} {t("logsMedia.input")}
					</div>
					<div className="space-y-2 p-6">
						<div className="text-muted-foreground text-xs font-medium">{t("logsMedia.prompt")}</div>
						<div className="font-mono text-xs">{videoInput.prompt}</div>
					</div>
				</div>
			)}

			{videoOutput && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Video className="h-4 w-4" />
						{methodTypeLabel} {t("logsMedia.outputLabel")}
					</div>
					<div className="space-y-3 p-6">
						{downloadOutput ? (
							<>
								<div className="grid grid-cols-3 gap-3">
									{downloadOutput.video_id && (
										<div className="space-y-1">
											<div className="text-muted-foreground text-xs font-medium">{t("logsMedia.videoId")}</div>
											<div className="font-mono text-xs break-all">{downloadOutput.video_id}</div>
										</div>
									)}
									{downloadOutput.content_type && (
										<div className="space-y-1">
											<div className="text-muted-foreground text-xs font-medium">{t("logsMedia.contentType")}</div>
											<div className="font-mono text-xs">{downloadOutput.content_type}</div>
										</div>
									)}
								</div>
								<p className="text-muted-foreground text-xs">{t("logsMedia.videoDownloadNotStored")}</p>
							</>
						) : generationOutput ? (
							<>
								<div className="grid grid-cols-3 gap-3">
									{generationOutput.status && (
										<div className="space-y-1">
											<div className="text-muted-foreground text-xs font-medium">{t("logsMedia.status")}</div>
											<Badge variant="secondary" className="uppercase">
												{generationOutput.status}
											</Badge>
										</div>
									)}
									{generationOutput.progress !== undefined && (
										<div className="space-y-1">
											<div className="text-muted-foreground text-xs font-medium">{t("logsMedia.progress")}</div>
											<div className="font-mono text-xs">{generationOutput.progress}%</div>
										</div>
									)}
									{generationOutput.id && (
										<div className="space-y-1">
											<div className="text-muted-foreground text-xs font-medium">{t("logsMedia.videoId")}</div>
											<div className="font-mono text-xs break-all">{generationOutput.id}</div>
										</div>
									)}
								</div>

								{generationOutput.error && (generationOutput.error.message || generationOutput.error.code) && (
									<div className="flex items-start gap-2 rounded-md border px-3 py-2 text-sm">
										<div className="space-y-1">
											<div className="text-muted-foreground font-medium">{t("logsMedia.providerError")}</div>
											{generationOutput.error.code && <div className="font-medium">{generationOutput.error.code}</div>}
											{generationOutput.error.message && <div className="text-muted-foreground">{generationOutput.error.message}</div>}
										</div>
									</div>
								)}

								{outputURL && (
									<div className="space-y-2">
										<video className="w-full rounded-sm border bg-black" controls preload="metadata" src={outputURL}>
											<track kind="captions" />
										</video>
										<a
											href={outputURL}
											target="_blank"
											rel="noopener noreferrer"
											className="text-primary inline-flex items-center gap-1 text-xs underline"
										>
											{t("logsMedia.openVideoUrl")}
											<ExternalLink className="h-3 w-3" />
										</a>
									</div>
								)}
							</>
						) : null}
					</div>
				</div>
			)}

			{videoListOutput && (
				<CollapsibleBox
					title={t("logsMedia.videoListOutput", { count: videoListOutput.data?.length ?? 0 })}
					onCopy={() => JSON.stringify(videoListOutput, null, 2)}
				>
					<CodeEditor
						className="z-0 w-full"
						shouldAdjustInitialHeight={true}
						maxHeight={450}
						wrap={true}
						code={JSON.stringify(videoListOutput.data, null, 2)}
						lang="json"
						readonly={true}
						options={{ scrollBeyondLastLine: false, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
					/>
				</CollapsibleBox>
			)}
		</div>
	);
}
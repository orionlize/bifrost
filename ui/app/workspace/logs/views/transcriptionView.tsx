import { Badge } from "@/components/ui/badge";
import { CodeEditor } from "@/components/ui/codeEditor";
import { BifrostTranscribe, TranscriptionInput } from "@/lib/types/logs";
import { isLogBinaryPlaceholder } from "@/lib/utils/logBinaryPlaceholder";
import { Clock, FileAudio, Mic } from "lucide-react";
import AudioPlayer from "./audioPlayer";
import { useT } from "@/lib/i18n";

interface TranscriptionViewProps {
	transcriptionInput?: TranscriptionInput;
	transcriptionOutput?: BifrostTranscribe;
	isStreaming?: boolean;
}

function TranscriptionView({ transcriptionInput, transcriptionOutput, isStreaming }: TranscriptionViewProps) {
	const t = useT();
	const formatTime = (seconds: number) => {
		const mins = Math.floor(seconds / 60);
		const secs = (seconds % 60).toFixed(1);
		return `${mins}:${secs.padStart(4, "0")}`;
	};

	return (
		<div className="space-y-4">
			{/* {t("logsMedia.input")} */}
			{transcriptionInput && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<FileAudio className="h-4 w-4" />
						{t("logsMedia.input")}
					</div>
					<div className="space-y-4 p-6">
						<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.audioFile")}</div>
						{transcriptionInput.file && !isLogBinaryPlaceholder(transcriptionInput.file) ? (
							<AudioPlayer src={transcriptionInput.file} />
						) : (
							<div className="text-muted-foreground font-mono text-xs">{t("logsMedia.audioPlaceholder")}</div>
						)}
					</div>
				</div>
			)}

			{/* {t("logsMedia.outputLabel")} */}
			{(transcriptionOutput || isStreaming) && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Mic className="h-4 w-4" />
						{t("logsMedia.outputLabel")}
					</div>

					<div className="space-y-4 p-6">
						{!transcriptionOutput && isStreaming ? (
							<div className="font-mono text-xs">{t("logsMedia.streamedOutputUnavailable")}</div>
						) : (
							<>
								{/* Main Transcription Text */}
								<div>
									<div className="font-mono text-xs">{transcriptionOutput?.text}</div>
								</div>

								{/* Basic Information */}
								{(transcriptionOutput?.task || transcriptionOutput?.language || transcriptionOutput?.duration) && (
									<div className="grid grid-cols-3 gap-4">
										{transcriptionOutput?.task && (
											<div>
												<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.task")}</div>
												<div className="font-mono text-xs">{transcriptionOutput.task}</div>
											</div>
										)}

										{transcriptionOutput?.language && (
											<div>
												<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.detectedLanguage")}</div>
												<div className="font-mono text-xs">{transcriptionOutput.language}</div>
											</div>
										)}

										{transcriptionOutput?.duration && (
											<div>
												<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.duration")}</div>
												<div className="font-mono text-xs">{transcriptionOutput.duration.toFixed(1)}s</div>
											</div>
										)}
									</div>
								)}

								{/* Words with Timing */}
								{transcriptionOutput?.words && transcriptionOutput.words.length > 0 && (
									<div>
										<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.wordLevelTiming")}</div>
										<div className="max-h-40 overflow-y-auto">
											<div className="flex flex-wrap gap-2">
												{transcriptionOutput.words.map((word, index) => (
													<div
														key={index}
														className="inline-flex items-center gap-1 rounded border px-2 py-1 text-xs"
														title={`${formatTime(word.start)} - ${formatTime(word.end)}`}
													>
														<span>{word.word}</span>
														<span className="text-muted-foreground text-xs">{formatTime(word.start)}</span>
													</div>
												))}
											</div>
										</div>
									</div>
								)}

								{/* Segments */}
								{transcriptionOutput?.segments && transcriptionOutput.segments.length > 0 && (
									<div>
										<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.segments")}</div>
										<div className="max-h-60 space-y-2 overflow-y-auto">
											{transcriptionOutput.segments.map((segment) => (
												<div key={segment.id} className="rounded border p-3">
													<div className="mb-2 flex items-center justify-between">
														<Badge variant="outline" className="text-xs">
															Segment {segment.id}
														</Badge>
														<div className="text-muted-foreground flex items-center gap-1 text-xs">
															<Clock className="h-3 w-3" />
															{formatTime(segment.start)} - {formatTime(segment.end)}
														</div>
													</div>
													<div className="text-sm">{segment.text}</div>
													<div className="text-muted-foreground mt-2 flex gap-4 text-xs">
														<span>
															{t("logsMedia.avgLogProb")}: {segment.avg_logprob.toFixed(3)}
														</span>
														<span>
															{t("logsMedia.noSpeech")}: {(segment.no_speech_prob * 100).toFixed(1)}%
														</span>
														<span>
															{t("logsMedia.temp")}: {segment.temperature.toFixed(1)}
														</span>
													</div>
												</div>
											))}
										</div>
									</div>
								)}

								{/* Log Probabilities */}
								{transcriptionOutput?.logprobs && transcriptionOutput.logprobs.length > 0 && (
									<div>
										<div className="text-muted-foreground mb-2 text-xs font-medium">{t("logsMedia.logProbabilitiesLabel")}</div>
										<CodeEditor
											className="z-0 w-full"
											shouldAdjustInitialHeight={true}
											maxHeight={200}
											wrap={true}
											code={JSON.stringify(transcriptionOutput.logprobs, null, 2)}
											lang="json"
											readonly={true}
											options={{
												scrollBeyondLastLine: false,
												collapsibleBlocks: true,
												lineNumbers: "off",
												alwaysConsumeMouseWheel: false,
											}}
										/>
									</div>
								)}
							</>
						)}
					</div>
				</div>
			)}
		</div>
	);
}
export default TranscriptionView;
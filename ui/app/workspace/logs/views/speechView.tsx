import { BifrostSpeech, SpeechInput } from "@/lib/types/logs";
import { isLogBinaryPlaceholder } from "@/lib/utils/logBinaryPlaceholder";
import { AlertCircle, Play, Volume2 } from "lucide-react";
import React, { Component } from "react";
import { useT } from "@/lib/i18n";
import type { TranslateFn } from "@/lib/i18n";
import AudioPlayer from "./audioPlayer";

interface SpeechViewProps {
	speechInput?: SpeechInput;
	speechOutput?: BifrostSpeech;
	isStreaming?: boolean;
}

// Error boundary specifically for audio player errors
class AudioErrorBoundary extends Component<{ children: React.ReactNode; t: TranslateFn }, { hasError: boolean; error: Error | null }> {
	constructor(props: { children: React.ReactNode; t: TranslateFn }) {
		super(props);
		this.state = { hasError: false, error: null };
	}

	static getDerivedStateFromError(error: Error) {
		return { hasError: true, error };
	}

	componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
		console.error("Audio player error:", error, errorInfo);
	}

	render() {
		if (this.state.hasError) {
			return (
				<div className="flex items-center gap-2 rounded-sm border border-red-200 bg-red-50 p-4 text-sm text-red-800">
					<AlertCircle className="h-4 w-4" />
					<span>{this.props.t("logsMedia.audioLoadFailed", { error: this.state.error?.message || this.props.t("logsMedia.unknownError") })}</span>
				</div>
			);
		}

		return this.props.children;
	}
}

function SpeechView({ speechInput, speechOutput, isStreaming }: SpeechViewProps) {
	const t = useT();
	return (
		<div className="space-y-4">
			{/* Speech Input */}
			{speechInput && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Volume2 className="h-4 w-4" />
						{t("logsMedia.speechInput")}
					</div>
					<div className="space-y-4 p-6">
						<div className="font-mono text-xs">{speechInput.input}</div>
					</div>
				</div>
			)}

			{/* Speech Output */}
			{(speechOutput || isStreaming) && (
				<div className="w-full rounded-sm border">
					<div className="flex items-center gap-2 border-b px-6 py-2 text-sm font-medium">
						<Play className="h-4 w-4" />
						{t("logsMedia.speechOutput")}
					</div>
					<div className="space-y-4 p-6">
						{speechOutput?.audio && !isLogBinaryPlaceholder(speechOutput.audio) ? (
							<AudioErrorBoundary t={t}>
								<AudioPlayer src={speechOutput.audio} />
							</AudioErrorBoundary>
						) : speechOutput ? (
							<div className="text-muted-foreground font-mono text-xs">{t("logsMedia.audioPlaceholder")}</div>
						) : null}
					</div>
				</div>
			)}
		</div>
	);
}
export default SpeechView;

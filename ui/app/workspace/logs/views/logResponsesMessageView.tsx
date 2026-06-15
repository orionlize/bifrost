import { CodeEditor } from "@/components/ui/codeEditor";
import { useT, type TranslateFn } from "@/lib/i18n";
import { ResponsesMessage, ResponsesMessageContentBlock } from "@/lib/types/logs";
import { isLogBinaryPlaceholder } from "@/lib/utils/logBinaryPlaceholder";
import { cleanJson, isJson } from "@/lib/utils/validation";
import CollapsibleBox from "./collapsibleBox";

interface LogResponsesMessageViewProps {
	messages: ResponsesMessage[];
}

function getBlockTitle(t: TranslateFn, type: string): string {
	switch (type) {
		case "input_text":
			return t("logsMedia.inputText");
		case "input_image":
			return t("logsMedia.inputImage");
		case "input_file":
			return t("logsMedia.inputFile");
		case "input_audio":
			return t("logsMedia.inputAudio");
		case "output_text":
			return t("logsMedia.outputText");
		case "reasoning_text":
			return t("logsMedia.reasoningText");
		case "refusal":
			return t("logsMedia.refusal");
		default:
			return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
	}
}

function getMessageTitle(t: TranslateFn, message: ResponsesMessage): string {
	if (message.type) {
		switch (message.type) {
			case "reasoning":
				return t("logsMedia.reasoning");
			case "message":
				return message.role
					? t("logsMedia.roleMessage", { role: message.role.charAt(0).toUpperCase() + message.role.slice(1) })
					: t("logsMedia.message");
			case "function_call":
				return t("logsMedia.functionCallNamed", { name: message.name || "Unknown" });
			case "function_call_output":
				return message.call_id ? t("logsMedia.functionCallOutputId", { id: message.call_id }) : t("logsMedia.functionCallOutput");
			case "file_search_call":
				return t("logsMedia.fileSearch");
			case "web_search_call":
				return t("logsMedia.webSearch");
			case "computer_call":
				return t("logsMedia.computerAction");
			case "computer_call_output":
				return t("logsMedia.computerActionOutput");
			case "code_interpreter_call":
				return t("logsMedia.codeInterpreter");
			case "mcp_call":
				return t("logsMedia.mcpToolCall");
			case "custom_tool_call":
				return t("logsMedia.customToolCall");
			case "custom_tool_call_output":
				return t("logsMedia.customToolOutput");
			case "image_generation_call":
				return t("logsMedia.imageGeneration");
			case "refusal":
				return t("logsMedia.refusal");
			default:
				return message.type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase());
		}
	}
	return message.role ? message.role.charAt(0).toUpperCase() + message.role.slice(1) : t("logsMedia.message");
}

function ContentBlockView({ block }: { block: ResponsesMessageContentBlock; index: number }) {
	const t = useT();
	const blockTitle = getBlockTitle(t, block.type);

	// Handle text content
	if (block.text) {
		if (isJson(block.text)) {
			const jsonContent = JSON.stringify(cleanJson(block.text), null, 2);
			return (
				<CollapsibleBox title={blockTitle} onCopy={() => jsonContent} collapsedHeight={100}>
					<CodeEditor
						className="z-0 w-full"
						shouldAdjustInitialHeight={true}
						maxHeight={200}
						wrap={true}
						code={jsonContent}
						lang="json"
						readonly={true}
						options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
					/>
				</CollapsibleBox>
			);
		}
		return (
			<CollapsibleBox title={blockTitle} onCopy={() => block.text || ""} collapsedHeight={100}>
				<div className="custom-scrollbar max-h-[400px] overflow-y-auto px-6 py-2 font-mono text-xs whitespace-pre-wrap">{block.text}</div>
			</CollapsibleBox>
		);
	}

	// Handle image content
	if (block.image_url) {
		if (isLogBinaryPlaceholder(block.image_url)) {
			return (
				<CollapsibleBox title={blockTitle} onCopy={() => block.image_url || ""} collapsedHeight={100}>
					<div className="text-muted-foreground px-6 py-2 font-mono text-xs">{block.image_url}</div>
				</CollapsibleBox>
			);
		}
		const jsonContent = JSON.stringify(
			{
				image_url: block.image_url,
				...(block.detail && { detail: block.detail }),
			},
			null,
			2,
		);
		return (
			<CollapsibleBox title={blockTitle} onCopy={() => jsonContent} collapsedHeight={100}>
				<CodeEditor
					className="z-0 w-full"
					shouldAdjustInitialHeight={true}
					maxHeight={150}
					wrap={true}
					code={jsonContent}
					lang="json"
					readonly={true}
					options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
				/>
			</CollapsibleBox>
		);
	}

	// Handle file content
	if (block.file_id || block.file_data || block.file_url) {
		const fileLabel =
			(block.file_data && isLogBinaryPlaceholder(block.file_data) && block.file_data) ||
			(block.file_url && isLogBinaryPlaceholder(block.file_url) && block.file_url) ||
			(block.file_data ? "[file]" : undefined);
		if (fileLabel) {
			return (
				<CollapsibleBox title={blockTitle} onCopy={() => fileLabel} collapsedHeight={100}>
					<div className="text-muted-foreground px-6 py-2 font-mono text-xs">{fileLabel}</div>
				</CollapsibleBox>
			);
		}
		const jsonContent = JSON.stringify(
			{
				...(block.filename && { filename: block.filename }),
				...(block.file_id && { file_id: block.file_id }),
				...(block.file_url && { file_url: block.file_url }),
				...(block.file_data && { file_data: "[Base64 encoded data]" }),
			},
			null,
			2,
		);
		return (
			<CollapsibleBox title={blockTitle} onCopy={() => jsonContent} collapsedHeight={100}>
				<CodeEditor
					className="z-0 w-full"
					shouldAdjustInitialHeight={true}
					maxHeight={150}
					wrap={true}
					code={jsonContent}
					lang="json"
					readonly={true}
					options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
				/>
			</CollapsibleBox>
		);
	}

	// Handle audio content
	if (block.input_audio) {
		if (block.input_audio.data && isLogBinaryPlaceholder(block.input_audio.data)) {
			return (
				<CollapsibleBox title={blockTitle} onCopy={() => block.input_audio!.data} collapsedHeight={100}>
					<div className="text-muted-foreground px-6 py-2 font-mono text-xs">{block.input_audio.data}</div>
				</CollapsibleBox>
			);
		}
		const jsonContent = JSON.stringify(block.input_audio, null, 2);
		return (
			<CollapsibleBox title={blockTitle} onCopy={() => jsonContent} collapsedHeight={100}>
				<CodeEditor
					className="z-0 w-full"
					shouldAdjustInitialHeight={true}
					maxHeight={150}
					wrap={true}
					code={jsonContent}
					lang="json"
					readonly={true}
					options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
				/>
			</CollapsibleBox>
		);
	}

	// Handle refusal content
	if (block.refusal) {
		return (
			<CollapsibleBox title={blockTitle} onCopy={() => block.refusal || ""} collapsedHeight={100}>
				<div className="custom-scrollbar max-h-[400px] overflow-y-auto px-6 py-2 font-mono text-xs text-red-800">{block.refusal}</div>
			</CollapsibleBox>
		);
	}

	// Handle annotations
	if (block.annotations && block.annotations.length > 0) {
		const jsonContent = JSON.stringify(block.annotations, null, 2);
		return (
			<CollapsibleBox title={t("logsMedia.annotations")} onCopy={() => jsonContent} collapsedHeight={100}>
				<CodeEditor
					className="z-0 w-full"
					shouldAdjustInitialHeight={true}
					maxHeight={150}
					wrap={true}
					code={jsonContent}
					lang="json"
					readonly={true}
					options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
				/>
			</CollapsibleBox>
		);
	}

	// Handle log probabilities
	if (block.logprobs && block.logprobs.length > 0) {
		const jsonContent = JSON.stringify(block.logprobs, null, 2);
		return (
			<CollapsibleBox title={t("logsMedia.logProbabilities")} onCopy={() => jsonContent} collapsedHeight={100}>
				<CodeEditor
					className="z-0 w-full"
					shouldAdjustInitialHeight={true}
					maxHeight={150}
					wrap={true}
					code={jsonContent}
					lang="json"
					readonly={true}
					options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
				/>
			</CollapsibleBox>
		);
	}

	return null;
}

function MessageView({ message, index }: { message: ResponsesMessage; index: number }) {
	const t = useT();

	if (message.type == "reasoning" && (!message.summary || message.summary.length === 0) && !message.encrypted_content && !message.content) {
		return null;
	}

	const messageTitle = getMessageTitle(t, message);

	return (
		<div key={`message-${index}`} className="flex w-full flex-col gap-2">
			{/* Message title header */}
			<div className="text-sm font-medium">{messageTitle}</div>

			{/* Handle reasoning content */}
			{message.type === "reasoning" && message.summary && message.summary.length > 0 && (
				<>
					{message.summary.every((item) => item.type === "summary_text") ? (
						// Display as readable text when all items are summary_text
						message.summary.map((reasoningContent, idx) => (
							<CollapsibleBox
								key={idx}
								title={t("logDetail.summaryN", { n: idx + 1 })}
								onCopy={() => reasoningContent.text || ""}
								collapsedHeight={100}
							>
								<div className="custom-scrollbar max-h-[400px] overflow-y-auto px-6 py-2 font-mono text-xs whitespace-pre-wrap">
									{reasoningContent.text}
								</div>
							</CollapsibleBox>
						))
					) : (
						// Fallback to JSON display for mixed or non-text types
						<CollapsibleBox
							title={t("logsMedia.summaryHeading")}
							onCopy={() => JSON.stringify(message.summary, null, 2)}
							collapsedHeight={100}
						>
							<CodeEditor
								className="z-0 w-full"
								shouldAdjustInitialHeight={true}
								maxHeight={300}
								wrap={true}
								code={JSON.stringify(message.summary, null, 2)}
								lang="json"
								readonly={true}
								options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
							/>
						</CollapsibleBox>
					)}
				</>
			)}

			{/* Handle encrypted reasoning content */}
			{message.type === "reasoning" && message.encrypted_content && (
				<CollapsibleBox
					title={t("logsMedia.encryptedReasoningContent")}
					onCopy={() => message.encrypted_content || ""}
					collapsedHeight={100}
				>
					<div className="custom-scrollbar max-h-[400px] overflow-y-auto px-6 py-2 font-mono text-xs break-words whitespace-pre-wrap">
						{message.encrypted_content}
					</div>
				</CollapsibleBox>
			)}

			{/* Handle regular content */}
			{message.content && (
				<>
					{typeof message.content === "string" ? (
						<>
							{isJson(message.content) ? (
								<CollapsibleBox
									title={t("logsMedia.content")}
									onCopy={() => JSON.stringify(cleanJson(message.content as string), null, 2)}
									collapsedHeight={100}
								>
									<CodeEditor
										className="z-0 w-full"
										shouldAdjustInitialHeight={true}
										maxHeight={250}
										wrap={true}
										code={JSON.stringify(cleanJson(message.content), null, 2)}
										lang="json"
										readonly={true}
										options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
									/>
								</CollapsibleBox>
							) : (
								<CollapsibleBox title={t("logsMedia.content")} onCopy={() => (message.content as string) || ""} collapsedHeight={100}>
									<div className="custom-scrollbar max-h-[400px] overflow-y-auto px-6 py-2 font-mono text-xs break-words whitespace-pre-wrap">
										{message.content}
									</div>
								</CollapsibleBox>
							)}
						</>
					) : (
						Array.isArray(message.content) &&
						message.content.map((block, blockIndex) => <ContentBlockView key={blockIndex} block={block} index={blockIndex} />)
					)}
				</>
			)}

			{/* Handle tool call specific fields */}
			{(message.call_id || message.name || message.arguments) && (
				<CollapsibleBox
					title={t("logsMedia.toolDetails")}
					onCopy={() =>
						JSON.stringify(
							{
								...(message.call_id && { call_id: message.call_id }),
								...(message.name && { name: message.name }),
								...(message.arguments && { arguments: isJson(message.arguments) ? cleanJson(message.arguments) : message.arguments }),
							},
							null,
							2,
						)
					}
					collapsedHeight={100}
				>
					<CodeEditor
						className="z-0 w-full"
						shouldAdjustInitialHeight={true}
						maxHeight={400}
						wrap={true}
						code={JSON.stringify(
							{
								...(message.call_id && { call_id: message.call_id }),
								...(message.name && { name: message.name }),
								...(message.arguments && { arguments: isJson(message.arguments) ? cleanJson(message.arguments) : message.arguments }),
							},
							null,
							2,
						)}
						lang="json"
						readonly={true}
						options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
					/>
				</CollapsibleBox>
			)}

			{/* Handle function call output */}
			{message.output !== undefined && (
				<CollapsibleBox
					title={t("logsMedia.output")}
					onCopy={() => (typeof message.output === "string" ? message.output : JSON.stringify(message.output, null, 2))}
					collapsedHeight={100}
				>
					{typeof message.output === "string" ? (
						isJson(message.output) ? (
							<CodeEditor
								className="z-0 w-full"
								shouldAdjustInitialHeight={true}
								maxHeight={400}
								wrap={true}
								code={JSON.stringify(cleanJson(message.output), null, 2)}
								lang="json"
								readonly={true}
								options={{ scrollBeyondLastLine: false, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
							/>
						) : (
							<div className="custom-scrollbar max-h-[400px] overflow-y-auto px-6 py-2 font-mono text-xs break-words whitespace-pre-wrap">
								{message.output}
							</div>
						)
					) : (
						<CodeEditor
							className="z-0 w-full"
							shouldAdjustInitialHeight={true}
							maxHeight={400}
							wrap={true}
							code={JSON.stringify(message.output, null, 2)}
							lang="json"
							readonly={true}
							options={{ scrollBeyondLastLine: false, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
						/>
					)}
				</CollapsibleBox>
			)}

			{/* Handle additional tool-specific fields */}
			{Object.keys(message).some(
				(key) =>
					!["id", "type", "status", "role", "content", "call_id", "name", "arguments", "summary", "encrypted_content", "output"].includes(
						key,
					),
			) && (
				<CollapsibleBox
					title={t("logsMedia.additionalFields")}
					onCopy={() =>
						JSON.stringify(
							Object.fromEntries(
								Object.entries(message).filter(
									([key]) =>
										![
											"id",
											"type",
											"status",
											"role",
											"content",
											"call_id",
											"name",
											"arguments",
											"summary",
											"encrypted_content",
											"output",
										].includes(key),
								),
							),
							null,
							2,
						)
					}
					collapsedHeight={100}
				>
					<CodeEditor
						className="z-0 w-full"
						shouldAdjustInitialHeight={true}
						maxHeight={400}
						wrap={true}
						code={JSON.stringify(
							Object.fromEntries(
								Object.entries(message).filter(
									([key]) =>
										![
											"id",
											"type",
											"status",
											"role",
											"content",
											"call_id",
											"name",
											"arguments",
											"summary",
											"encrypted_content",
											"output",
										].includes(key),
								),
							),
							null,
							2,
						)}
						lang="json"
						readonly={true}
						options={{ scrollBeyondLastLine: false, collapsibleBlocks: true, lineNumbers: "off", alwaysConsumeMouseWheel: false }}
					/>
				</CollapsibleBox>
			)}
		</div>
	);
}

export default function LogResponsesMessageView({ messages }: LogResponsesMessageViewProps) {
	const t = useT();
	if (!messages || messages.length === 0) {
		return (
			<div className="w-full rounded-sm border">
				<div className="text-muted-foreground px-6 py-4 text-center text-sm">{t("logsMedia.noResponsesMessages")}</div>
			</div>
		);
	}

	return (
		<div className="space-y-4">
			{messages.map((message, index) => (
				<MessageView key={index} message={message} index={index} />
			))}
		</div>
	);
}
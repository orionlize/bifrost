import { FormControl, FormField, FormItem, FormLabel } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useT } from "@/lib/i18n";
import { BaseProvider, RequestType } from "@/lib/types/config";
import { isRequestTypeDisabled } from "@/lib/utils/validation";
import { Settings2 } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Control, useFormContext } from "react-hook-form";

interface AllowedRequestsFieldsProps {
	control: Control<any>;
	namePrefix?: string;
	pathOverridesPrefix?: string;
	providerType?: BaseProvider;
	disabled?: boolean;
}

const ProviderEndpoints: Partial<Record<BaseProvider, Partial<Record<RequestType, string>>>> = {
	openai: {
		list_models: "/v1/models",
		text_completion: "/v1/completions",
		text_completion_stream: "/v1/completions",
		chat_completion: "/v1/chat/completions",
		chat_completion_stream: "/v1/chat/completions",
		responses: "/v1/responses",
		responses_stream: "/v1/responses",
		embedding: "/v1/embeddings",
		speech: "/v1/audio/speech",
		speech_stream: "/v1/audio/speech",
		transcription: "/v1/audio/transcriptions",
		transcription_stream: "/v1/audio/transcriptions",
		image_generation: "/v1/images/generations",
		image_generation_stream: "/v1/images/generations",
		image_edit: "/v1/images/edits",
		image_edit_stream: "/v1/images/edits",
		image_variation: "/v1/images/variations",
		count_tokens: "/v1/responses/tokens",
	},
	anthropic: {
		chat_completion: "/v1/messages",
		chat_completion_stream: "/v1/messages",
		responses: "/v1/messages",
		responses_stream: "/v1/messages",
	},
	cohere: {
		chat_completion: "/v2/chat",
		chat_completion_stream: "/v2/chat",
		responses: "/v2/chat",
		responses_stream: "/v2/chat",
		embedding: "/v2/embed",
	},
};

const getPlaceholder = (providerType: BaseProvider | undefined, requestKey: RequestType): string => {
	if (providerType && ProviderEndpoints[providerType]?.[requestKey]) {
		return ProviderEndpoints[providerType][requestKey]!;
	}
	return ProviderEndpoints["openai"]?.[requestKey] ?? "";
};

export function AllowedRequestsFields({
	control,
	namePrefix = "allowed_requests",
	pathOverridesPrefix = "request_path_overrides",
	providerType,
	disabled = false,
}: AllowedRequestsFieldsProps) {
	const t = useT();
	const { getValues, setValue } = useFormContext();

	const requestTypes: Array<{ key: RequestType; label: string }> = useMemo(
		() => [
			{ key: "list_models", label: t("providers.allowedRequests.listModels") },
			{ key: "text_completion", label: t("providers.allowedRequests.textCompletion") },
			{ key: "text_completion_stream", label: t("providers.allowedRequests.textCompletionStream") },
			{ key: "chat_completion", label: t("providers.allowedRequests.chatCompletion") },
			{ key: "chat_completion_stream", label: t("providers.allowedRequests.chatCompletionStream") },
			{ key: "responses", label: t("providers.allowedRequests.responses") },
			{ key: "responses_stream", label: t("providers.allowedRequests.responsesStream") },
			{ key: "embedding", label: t("providers.allowedRequests.embedding") },
			{ key: "speech", label: t("providers.allowedRequests.speech") },
			{ key: "speech_stream", label: t("providers.allowedRequests.speechStream") },
			{ key: "transcription", label: t("providers.allowedRequestsFields.transcription") },
			{ key: "transcription_stream", label: t("providers.allowedRequestsFields.transcriptionStream") },
			{ key: "image_generation", label: t("providers.allowedRequestsFields.imageGeneration") },
			{ key: "image_generation_stream", label: t("providers.allowedRequestsFields.imageGenerationStream") },
			{ key: "image_edit", label: t("providers.allowedRequestsFields.imageEdit") },
			{ key: "image_edit_stream", label: t("providers.allowedRequestsFields.imageEditStream") },
			{ key: "image_variation", label: t("providers.allowedRequestsFields.imageVariation") },
			{ key: "count_tokens", label: t("providers.allowedRequestsFields.countTokens") },
		],
		[t],
	);

	useEffect(() => {
		requestTypes.forEach(({ key }) => {
			const fieldName = `${namePrefix}.${key}`;
			setValue(fieldName, !isRequestTypeDisabled(providerType, key), { shouldDirty: true });
		});
	}, [providerType, namePrefix, setValue, getValues, requestTypes]);

	const isPathOverrideDisabled = useMemo(() => providerType === "gemini" || providerType === "bedrock", [providerType]);

	const leftColumn = requestTypes.slice(0, requestTypes.length / 2);
	const rightColumn = requestTypes.slice(requestTypes.length / 2);

	const renderRequestField = (requestType: { key: RequestType; label: string }) => {
		const isDisabled = isRequestTypeDisabled(providerType, requestType.key);
		const placeholder = getPlaceholder(providerType, requestType.key);

		return (
			<FormField
				key={requestType.key}
				control={control}
				name={`${namePrefix}.${requestType.key}`}
				render={({ field: allowedField }) => (
					<FormItem
						className={`flex flex-row items-center justify-between rounded-lg border p-3 ${isDisabled ? "bg-muted/30 opacity-60" : ""}`}
					>
						<div className="space-y-0.5">
							<FormLabel className={isDisabled ? "cursor-not-allowed" : ""}>{requestType.label}</FormLabel>
						</div>
						<div className="flex items-center gap-2">
							{allowedField.value && !isDisabled && !isPathOverrideDisabled && !disabled && (
								<FormField
									control={control}
									name={`${pathOverridesPrefix}.${requestType.key}`}
									render={({ field: pathField }) => (
										<Popover>
											<PopoverTrigger asChild>
												<button
													type="button"
													className="text-muted-foreground hover:text-foreground transition-colors"
													aria-label={t("providers.allowedRequestsFields.customizePathAria")}
												>
													<Settings2 className="h-4 w-4" />
												</button>
											</PopoverTrigger>
											<PopoverContent className="w-80" align="end" onOpenAutoFocus={(e) => e.preventDefault()}>
												<div className="space-y-2">
													<h4 className="text-sm font-medium">{t("providers.allowedRequestsFields.customPathTitle")}</h4>
													<p className="text-muted-foreground text-xs">{t("providers.allowedRequestsFields.customPathDesc")}</p>
													<Input placeholder={placeholder} {...pathField} value={pathField.value || ""} className="h-9" />
												</div>
											</PopoverContent>
										</Popover>
									)}
								/>
							)}

							<FormControl>
								{isDisabled ? (
									<TooltipProvider>
										<Tooltip>
											<TooltipTrigger asChild>
												<div>
													<Switch checked={isDisabled ? false : allowedField.value} disabled={true} size="md" />
												</div>
											</TooltipTrigger>
											<TooltipContent>
												<p>{t("providers.allowedRequestsFields.notSupported", { provider: providerType ?? "" })}</p>
											</TooltipContent>
										</Tooltip>
									</TooltipProvider>
								) : (
									<Switch checked={allowedField.value} onCheckedChange={allowedField.onChange} size="md" disabled={disabled} />
								)}
							</FormControl>
						</div>
					</FormItem>
				)}
			/>
		);
	};

	return (
		<div className="space-y-4">
			<div>
				<div className="text-sm font-medium">{t("providers.allowedRequestsFields.title")}</div>
				<p className="text-muted-foreground text-xs">
					{t("providers.allowedRequestsFields.description")} {!isPathOverrideDisabled ? t("providers.allowedRequestsFields.pathHint") : ""}
				</p>
			</div>

			<div className="grid grid-cols-2 gap-4">
				<div className="space-y-3">{leftColumn.map(renderRequestField)}</div>
				<div className="space-y-3">{rightColumn.map(renderRequestField)}</div>
			</div>
		</div>
	);
}
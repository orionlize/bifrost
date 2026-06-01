import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getErrorMessage } from "@/lib/store";
import { useCreatePromptMutation, useUpdatePromptMutation } from "@/lib/store/apis/promptsApi";
import { Prompt } from "@/lib/types/prompts";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { useT } from "@/lib/i18n";

interface PromptFormData {
	name: string;
}

interface PromptSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	prompt?: Prompt;
	folderId?: string;
	onSaved: (promptId?: string) => void;
}

export function PromptSheet({ open, onOpenChange, prompt, folderId, onSaved }: PromptSheetProps) {
	const t = useT();
	const [createPrompt, { isLoading: isCreating }] = useCreatePromptMutation();
	const [updatePrompt, { isLoading: isUpdating }] = useUpdatePromptMutation();

	const isLoading = isCreating || isUpdating;
	const isEditing = !!prompt;

	const {
		register,
		handleSubmit,
		reset,
		formState: { errors },
	} = useForm<PromptFormData>({
		defaultValues: { name: "" },
	});

	useEffect(() => {
		if (open) {
			reset({ name: prompt?.name ?? "" });
		}
	}, [open, prompt, reset]);

	async function onSubmit(data: PromptFormData) {
		try {
			if (isEditing) {
				await updatePrompt({
					id: prompt.id,
					data: { name: data.name.trim() },
				}).unwrap();
				toast.success(t("prompts.promptUpdated"));
				onSaved();
			} else {
				const result = await createPrompt({
					name: data.name.trim(),
					...(folderId ? { folder_id: folderId } : {}),
				}).unwrap();
				toast.success(t("prompts.promptCreated"));
				onSaved(result.prompt.id);
			}
			onOpenChange(false);
		} catch (err) {
			toast.error(`Failed to ${isEditing ? "update" : "create"} prompt`, {
				description: getErrorMessage(err),
			});
		}
	}

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent
				className="p-0"
				onOpenAutoFocus={(e) => {
					e.preventDefault();
					document.getElementById("name")?.focus();
				}}
			>
				<form onSubmit={handleSubmit(onSubmit)} className="flex grow flex-col">
					<SheetHeader className="flex flex-col items-start px-8 pt-8">
						<SheetTitle>{isEditing ? t("prompts.renamePrompt") : t("prompts.emptyState.createPrompt")}</SheetTitle>
						<SheetDescription>
							{isEditing ? t("prompts.updatePromptDesc") : folderId ? t("prompts.createInFolder") : t("prompts.createPromptDesc")}
						</SheetDescription>
					</SheetHeader>

					<div className="flex grow flex-col gap-6">
						<div className="grow space-y-4 px-8">
							<div className="space-y-2">
								<Label htmlFor="name">Name</Label>
								<Input
									id="name"
									data-testid="prompt-name-input"
									placeholder={t("prompts.promptNamePlaceholder")}
									{...register("name", {
										required: t("prompts.promptNameRequired"),
										validate: (v) => v.trim().length > 0 || t("prompts.promptNameBlank"),
									})}
									autoFocus
								/>
								{errors.name && <p className="text-destructive text-xs">{errors.name.message}</p>}
							</div>
						</div>

						<SheetFooter className="flex flex-row items-center justify-end gap-2 border-t px-8 py-4">
							<Button type="button" variant="outline" data-testid="prompt-cancel" onClick={() => onOpenChange(false)}>
								{t("common.actions.cancel")}
							</Button>
							<Button type="submit" data-testid="prompt-submit" disabled={isLoading}>
								{isLoading ? t("common.actions.saving") : isEditing ? t("common.actions.saveChanges") : t("common.actions.create")}
							</Button>
						</SheetFooter>
					</div>
				</form>
			</SheetContent>
		</Sheet>
	);
}
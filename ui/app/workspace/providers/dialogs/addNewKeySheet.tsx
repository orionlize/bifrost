import Provider from "@/components/provider";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n";
import { ModelProvider } from "@/lib/types/config";
import { toast } from "sonner";
import ProviderKeyForm from "../views/providerKeyForm";

interface Props {
	show: boolean;
	onCancel: () => void;
	provider: ModelProvider;
	keyId: string | null;
	providerName?: string;
}

export default function AddNewKeySheet({ show, onCancel, provider, keyId, providerName }: Props) {
	const t = useT();
	const isEditing = keyId !== null;
	const resolvedProviderName = (providerName ?? provider.name).toLowerCase();
	const isVLLM = resolvedProviderName === "vllm";
	const isOllamaOrSGL = resolvedProviderName === "ollama" || resolvedProviderName === "sgl";
	const entityLabel = isVLLM
		? t("providers.keysTable.entityModel")
		: isOllamaOrSGL
			? t("providers.keysTable.entityServer")
			: t("providers.keysTable.entityKey");
	const dialogTitle = isEditing ? t("providers.keySheet.editEntity", { entity: entityLabel }) : t("providers.keySheet.addEntity", { entity: entityLabel });
	const successMessage = isEditing
		? t("providers.keySheet.updatedSuccess", { entity: entityLabel })
		: t("providers.keySheet.addedSuccess", { entity: entityLabel });

	return (
		<Sheet
			open={show}
			onOpenChange={(open) => {
				if (!open) onCancel();
			}}
		>
			<SheetContent className="p-0 pt-4" data-testid="key-form" onInteractOutside={(e) => e.preventDefault()}>
				<SheetHeader className="flex flex-col items-start px-8 py-4" headerClassName="mb-0 sticky -top-4 bg-card z-10">
					<SheetTitle>
						<div className="font-lg flex items-center gap-2">
							<div className={"flex items-center"}>
								<Provider provider={provider.name} size={24} />:
							</div>
							{dialogTitle}
						</div>
					</SheetTitle>
				</SheetHeader>
				<ProviderKeyForm
					provider={provider}
					keyId={keyId}
					onCancel={onCancel}
					onSave={() => {
						toast.success(successMessage);
						onCancel();
					}}
				/>
			</SheetContent>
		</Sheet>
	);
}

import { useT } from "@/lib/i18n";
import { Flag } from "lucide-react";

export function FeatureFlagsEmptyState() {
	const t = useT();

	return (
		<div
			className="flex min-h-[60vh] w-full flex-col items-center justify-center gap-4 py-16 text-center"
			data-testid="feature-flags-empty-state"
		>
			<div className="text-muted-foreground">
				<Flag className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-muted-foreground text-xl font-medium">{t("configPages.featureFlagsEmpty")}</h1>
			</div>
		</div>
	);
}
import LoggingView from "@/app/workspace/config/views/loggingView";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/lib/i18n";

interface ObservabilitySettingsSheetProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
}

export function ObservabilitySettingsSheet({ open, onOpenChange }: ObservabilitySettingsSheetProps) {
	const t = useT();

	return (
		<Sheet open={open} onOpenChange={onOpenChange}>
			<SheetContent side="right" className="flex w-full flex-col overflow-x-hidden px-8 pt-6 sm:max-w-3xl">
				<SheetHeader className="">
					<SheetTitle className="text-lg font-semibold">{t("logsMedia.loggingSettings")}</SheetTitle>
				</SheetHeader>
				<div className="custom-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto">
					<LoggingView />
				</div>
			</SheetContent>
		</Sheet>
	);
}
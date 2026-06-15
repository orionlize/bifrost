import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { Activity, ArrowUpRight, Puzzle } from "lucide-react";

const CUSTOM_PLUGINS_DOCS_URL = "https://docs.getbifrost.ai/plugins";

interface PluginsEmptyStateProps {
	onCreateClick: () => void;
	canCreate?: boolean;
	onConfigureTracingClick?: () => void;
	canConfigureTracing?: boolean;
}

export function PluginsEmptyState({
	onCreateClick,
	canCreate = true,
	onConfigureTracingClick,
	canConfigureTracing = true,
}: PluginsEmptyStateProps) {
	const t = useT();

	return (
		<div
			className="flex min-h-[80vh] w-full flex-col items-center justify-center gap-4 py-16 text-center"
			data-testid="plugins-empty-state"
		>
			<div className="text-muted-foreground">
				<Puzzle className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />
			</div>
			<div className="flex flex-col gap-1">
				<h1 className="text-muted-foreground text-xl font-medium">{t("plugins.emptyState.title")}</h1>
				<div className="text-muted-foreground mx-auto mt-2 max-w-[600px] text-sm font-normal">{t("plugins.emptyState.description")}</div>
				<div className="mx-auto mt-6 flex flex-row flex-wrap items-center justify-center gap-2">
					<Button
						variant="outline"
						aria-label={t("plugins.emptyState.readMoreAria")}
						data-testid="plugins-button-read-more"
						onClick={() => {
							window.open(`${CUSTOM_PLUGINS_DOCS_URL}?utm_source=bfd`, "_blank", "noopener,noreferrer");
						}}
					>
						{t("shared.readMore")} <ArrowUpRight className="text-muted-foreground h-3 w-3" />
					</Button>
					{onConfigureTracingClick && (
						<Button
							variant="outline"
							aria-label={t("plugins.emptyState.configureTracingAria")}
							data-testid="plugins-button-configure-tracing"
							onClick={onConfigureTracingClick}
							disabled={!canConfigureTracing}
						>
							<Activity className="h-4 w-4" />
							{t("plugins.emptyState.configureTracing")}
						</Button>
					)}
					<Button
						aria-label={t("plugins.emptyState.createAria")}
						data-testid="plugins-button-install-new"
						onClick={onCreateClick}
						disabled={!canCreate}
					>
						{t("plugins.installNew")}
					</Button>
				</div>
			</div>
		</div>
	);
}
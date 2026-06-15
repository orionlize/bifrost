import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PlusIcon, SparklesIcon } from "lucide-react";

export type MarketplaceEmptyView = "plugin" | "skill" | "settings";

export function MarketplaceEmptyState({
	activeView,
	onImport,
	compact = false,
}: {
	activeView: MarketplaceEmptyView;
	onImport: () => void;
	compact?: boolean;
}) {
	const t = useT();

	const titleKey =
		activeView === "plugin"
			? "marketplace.empty.titlePlugins"
			: activeView === "skill"
				? "marketplace.empty.titleSkills"
				: "marketplace.empty.title";

	const descriptionKey =
		activeView === "plugin"
			? "marketplace.empty.descriptionPlugins"
			: activeView === "skill"
				? "marketplace.empty.descriptionSkills"
				: "marketplace.empty.description";

	const hints = [t("marketplace.empty.hints.zip"), t("marketplace.empty.hints.github"), t("marketplace.empty.hints.catalog")];

	return (
		<div
			className={cn(
				"relative flex w-full flex-col items-center justify-center overflow-hidden rounded-2xl border border-primary/10 text-center",
				"bg-gradient-to-b from-primary/[0.07] via-primary/[0.02] to-transparent",
				compact ? "min-h-[280px] px-4 py-10" : "min-h-[420px] px-6 py-16",
			)}
			data-testid="marketplace-empty-state"
		>
			<div className="bg-primary/15 pointer-events-none absolute -top-16 left-1/2 size-48 -translate-x-1/2 rounded-full blur-3xl" />
			<div className="pointer-events-none absolute right-8 bottom-0 size-32 rounded-full bg-violet-500/10 blur-3xl" />
			<div className="pointer-events-none absolute bottom-12 left-6 size-24 rounded-full bg-sky-500/10 blur-2xl" />

			<div className="relative mb-5">
				<div
					className={cn(
						"relative flex items-center justify-center rounded-[28%] bg-gradient-to-br from-primary/20 via-primary/10 to-violet-500/10 ring-1 ring-primary/15 shadow-lg shadow-primary/10",
						compact ? "size-16" : "size-20",
					)}
				>
					<SparklesIcon className={cn("text-primary", compact ? "size-7" : "size-9")} strokeWidth={1.5} />
					<div className="absolute inset-0 rounded-[28%] bg-[radial-gradient(circle_at_30%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
				</div>
				<span className="bg-primary/70 absolute -top-1 -right-1 size-2.5 animate-pulse rounded-full" />
				<span className="absolute -bottom-0.5 -left-1 size-1.5 rounded-full bg-violet-400/60" />
			</div>

			<p className="text-primary relative text-[11px] font-semibold tracking-[0.18em] uppercase">{t("marketplace.empty.eyebrow")}</p>
			<h2 className={cn("relative mt-2 font-semibold tracking-tight", compact ? "text-base" : "text-xl")}>{t(titleKey)}</h2>
			<p className="text-muted-foreground relative mt-2 max-w-md text-[13px] leading-relaxed">{t(descriptionKey)}</p>

			<div className="relative mt-5 flex flex-wrap items-center justify-center gap-2">
				{hints.map((hint) => (
					<Badge
						key={hint}
						variant="outline"
						className="border-primary/15 bg-background/60 text-muted-foreground rounded-full px-2.5 py-0.5 text-[11px] font-normal backdrop-blur-sm"
					>
						{hint}
					</Badge>
				))}
			</div>

			<Button
				className="shadow-primary/10 relative mt-6 h-9 gap-1.5 rounded-full px-5 text-[13px] font-semibold shadow-sm"
				onClick={onImport}
				data-testid="marketplace-empty-add-button"
			>
				<PlusIcon className="size-3.5" />
				{t("marketplace.empty.action")}
			</Button>
		</div>
	);
}
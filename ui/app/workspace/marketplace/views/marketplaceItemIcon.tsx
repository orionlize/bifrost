import { cn } from "@/lib/utils";
import { getApiBaseUrl } from "@/lib/utils/port";
import { MarketplaceItem } from "@/lib/types/marketplace";
import { PuzzleIcon, SparklesIcon } from "lucide-react";

export function resolveMarketplaceIconUrl(iconUrl?: string): string | undefined {
	if (!iconUrl?.trim()) return undefined;
	const trimmed = iconUrl.trim();
	if (trimmed.startsWith("http://") || trimmed.startsWith("https://") || trimmed.startsWith("data:")) {
		return trimmed;
	}
	const path = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
	return `${getApiBaseUrl()}${path}`;
}

function fallbackGradient(name: string): string {
	const palette = [
		"from-blue-500 to-indigo-600",
		"from-violet-500 to-purple-600",
		"from-emerald-500 to-teal-600",
		"from-orange-500 to-amber-600",
		"from-rose-500 to-pink-600",
		"from-cyan-500 to-sky-600",
	];
	const index = name.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0) % palette.length;
	return palette[index];
}

export function MarketplaceItemIcon({
	item,
	className,
	size = "md",
}: {
	item: Pick<MarketplaceItem, "name" | "item_type" | "icon_url">;
	className?: string;
	size?: "sm" | "md" | "lg" | "xl";
}) {
	const iconSrc = resolveMarketplaceIconUrl(item.icon_url);
	const sizeClass =
		size === "xl" ? "size-[72px]" : size === "lg" ? "size-20" : size === "sm" ? "size-12" : "size-16";
	const letter = item.name?.charAt(0)?.toUpperCase() || "?";
	const TypeIcon = item.item_type === "skill" ? SparklesIcon : PuzzleIcon;

	return (
		<div
			className={cn(
				"relative shrink-0 overflow-hidden rounded-[22%] bg-muted shadow-sm ring-1 ring-black/[0.06] dark:ring-white/10",
				sizeClass,
				className,
			)}
		>
			{iconSrc ? (
				<img src={iconSrc} alt="" className="size-full object-cover" loading="lazy" />
			) : (
				<div
					className={cn(
						"flex size-full flex-col items-center justify-center bg-gradient-to-br text-white",
						fallbackGradient(item.name),
					)}
				>
					<TypeIcon className="mb-0.5 size-4 opacity-90" strokeWidth={2} />
					<span className="text-lg font-semibold tracking-tight">{letter}</span>
				</div>
			)}
		</div>
	);
}

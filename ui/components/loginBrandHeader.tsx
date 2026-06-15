import { useWebsiteBranding } from "@/lib/hooks/useWebsiteBranding";
import { useT } from "@/lib/i18n";

interface LoginBrandHeaderProps {
	showWelcome?: boolean;
}

export function LoginBrandHeader({ showWelcome = true }: LoginBrandHeaderProps) {
	const t = useT();
	const { siteName, hasCustomIcon, brandSrc, isLoaded } = useWebsiteBranding({ preferPublicApi: true });

	return (
		<>
			<div className="flex items-center justify-center">
				{isLoaded ? (
					<img src={brandSrc} alt={siteName} className={hasCustomIcon ? "h-12 w-12 object-contain" : "h-[26px] w-auto max-w-[160px]"} />
				) : (
					<span className="inline-block h-[26px] w-[160px]" aria-hidden />
				)}
			</div>
			{showWelcome ? (
				<div className="space-y-2 text-center">
					<h1 className="text-foreground text-lg font-semibold">{isLoaded ? siteName : "\u00a0"}</h1>
					<p className="text-muted-foreground text-sm">{t("auth.signInWelcome")}</p>
				</div>
			) : null}
		</>
	);
}
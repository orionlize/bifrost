import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdownMenu";
import { localeLabels, useI18n, useT, type Locale } from "@/lib/i18n";
import { Languages } from "lucide-react";

const locales: Locale[] = ["en", "zh"];

export function LanguageSwitcher() {
	const { locale, setLocale } = useI18n();
	const t = useT();

	return (
		<DropdownMenu>
			<DropdownMenuTrigger asChild>
				<Button
					variant="ghost"
					size="icon"
					className="hover:text-primary text-muted-foreground h-7 w-7 border-0 ring-offset-0 outline-none select-none focus-visible:ring-0"
					data-testid="language-switcher-trigger"
					aria-label={t("common.language.label")}
				>
					<Languages className="h-4 w-4" strokeWidth={2} />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end">
				{locales.map((code) => (
					<DropdownMenuItem
						key={code}
						onClick={() => setLocale(code)}
						data-testid={`language-switcher-${code}`}
						className={locale === code ? "font-medium" : undefined}
					>
						{localeLabels[code].native}
					</DropdownMenuItem>
				))}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}

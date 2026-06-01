import { TRIAL_EXPIRY } from "@/lib/constants/config";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { differenceInDays } from "date-fns";
import { AlertTriangle } from "lucide-react";

export default function TrialExpiryBanner() {
	const t = useT();

	if (!TRIAL_EXPIRY) return null;

	const daysRemaining = differenceInDays(TRIAL_EXPIRY, new Date());
	const expired = daysRemaining < 0;
	if (!expired && daysRemaining > 7) return null;
	const critical = !expired && daysRemaining <= 3;

	const subject = expired ? t("shared.trial.subjectExpired") : t("shared.trial.subjectExtend");
	const supportHref = `mailto:contact@getmaxim.ai?subject=${encodeURIComponent(subject)}`;

	return (
		<div
			id="trial-notification-banner"
			className={cn(
				"sticky top-0 z-10 flex w-full items-center justify-center gap-2 rounded-tl-md rounded-tr-md px-4 py-2 text-xs font-medium",
				expired || critical ? "bg-red-500/10 text-red-700 dark:text-red-400" : "bg-amber-500/10 text-amber-700 dark:text-amber-400",
			)}
			role="status"
		>
			<AlertTriangle className="h-3.5 w-3.5" strokeWidth={2} />
			{expired ? (
				<span>
					{t("shared.trial.expired")}{" "}
					<a href={supportHref} className="font-semibold underline underline-offset-2">
						{t("shared.trial.contactUs")}
					</a>{" "}
					{t("shared.trial.assistance")}
				</span>
			) : (
				<span>
					{t("shared.trial.expiresIn", {
						days: daysRemaining,
						dayLabel: daysRemaining === 1 ? t("shared.trial.day") : t("shared.trial.days"),
					})}{" "}
					<a href={supportHref} className="font-semibold underline underline-offset-2">
						{t("shared.trial.contactUs")}
					</a>{" "}
					{t("shared.trial.assistance")}
				</span>
			)}
		</div>
	);
}

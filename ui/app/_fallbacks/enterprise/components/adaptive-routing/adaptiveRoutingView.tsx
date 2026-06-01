import { useT } from "@/lib/i18n";
import { Shuffle } from "lucide-react";
import ContactUsView from "../views/contactUsView";

export default function AdaptiveRoutingView() {
	const t = useT();
	return (
		<div className="h-full w-full">
			<ContactUsView
				className="mx-auto min-h-[80vh]"
				icon={<Shuffle className="h-[5.5rem] w-[5.5rem]" strokeWidth={1} />}
				title={t("enterprise.views.adaptiveRouting.title")}
				description={t("enterprise.licenseDescription")}
				readmeLink="https://docs.getbifrost.ai/enterprise/adaptive-load-balancing"
			/>
		</div>
	);
}

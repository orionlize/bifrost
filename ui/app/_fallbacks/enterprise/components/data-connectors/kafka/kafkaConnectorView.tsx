import { useT } from "@/lib/i18n";
import ContactUsView from "../../views/contactUsView";

interface KafkaConnectorViewProps {
	onDelete?: () => void;
	isDeleting?: boolean;
}

export default function KafkaConnectorView(_props: KafkaConnectorViewProps) {
	const t = useT();
	return (
		<div className="space-y-6">
			<div className="space-y-4">
				<div className="flex w-full flex-col items-center justify-center py-8">
					<ContactUsView
						align="middle"
						className="mx-auto w-full max-w-lg"
						testIdPrefix="kafka-connector"
						icon={<img src="/images/kafka-logo.svg" alt="Kafka" width={88} height={88} />}
						title={t("enterprise.views.kafka.title")}
						description={t("enterprise.licenseDescription")}
						readmeLink="https://docs.getbifrost.ai/enterprise/kafka-connector"
					/>
				</div>
			</div>
		</div>
	);
}
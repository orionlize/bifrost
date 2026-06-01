import { ScrollArea } from "@/components/ui/scrollArea";
import { MessagesView } from "../components/messagesView/rootMessageView";
import { NewMessageInputView } from "../components/newMessageInputView";
import { useT } from "@/lib/i18n";

export function PlaygroundPanel() {
	const t = useT();
	return (
		<div className="custom-scrollbar relative flex h-full flex-col overscroll-none">
			<ScrollArea className="flex-1 scroll-mb-12 overflow-y-auto" viewportClassName="no-table">
				<MessagesView />
			</ScrollArea>
			<NewMessageInputView />
		</div>
	);
}
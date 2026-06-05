import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
	useGetMarketplaceUserAssignmentsQuery,
	useListMarketplaceItemsQuery,
	useReplaceMarketplaceUserAssignmentsMutation,
} from "@/lib/store/apis/marketplaceApi";
import { Package } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

export default function MarketplaceUserAssignments({ userId }: { userId: string }) {
	const { data: assignmentsData, isLoading: assignmentsLoading } = useGetMarketplaceUserAssignmentsQuery(userId, { skip: !userId });
	const { data: itemsData } = useListMarketplaceItemsQuery({ limit: 500, enabled: true });
	const [replaceAssignments, { isLoading: saving }] = useReplaceMarketplaceUserAssignmentsMutation();
	const [selectedIds, setSelectedIds] = useState<number[]>([]);

	useEffect(() => {
		if (assignmentsData?.item_ids) {
			setSelectedIds(assignmentsData.item_ids);
		}
	}, [assignmentsData?.item_ids]);

	const items = itemsData?.items ?? [];

	return (
		<div className="space-y-3 rounded-lg border p-4" data-testid="marketplace-user-assignments">
			<div className="flex items-center gap-2">
				<Package className="size-4" />
				<p className="text-sm font-medium">Marketplace assignments</p>
			</div>
			{assignmentsLoading && <p className="text-muted-foreground text-sm">Loading assignments...</p>}
			<div className="max-h-56 space-y-2 overflow-y-auto">
				{items.map((item) => {
					const checked = selectedIds.includes(item.id);
					return (
						<div key={item.id} className="flex items-center gap-2">
							<Checkbox
								checked={checked}
								onCheckedChange={(next) => {
									setSelectedIds((prev) =>
										next ? [...prev, item.id] : prev.filter((id) => id !== item.id),
									);
								}}
								data-testid={`marketplace-assign-${item.name}`}
							/>
							<Label className="flex flex-1 items-center gap-2 text-sm font-normal">
								<span>{item.name}</span>
								<Badge variant="secondary">{item.item_type}</Badge>
							</Label>
						</div>
					);
				})}
				{items.length === 0 && <p className="text-muted-foreground text-sm">No marketplace items available.</p>}
			</div>
			<Button
				size="sm"
				disabled={saving}
				onClick={async () => {
					try {
						await replaceAssignments({ userId, body: { item_ids: selectedIds } }).unwrap();
						toast.success("Marketplace assignments updated");
					} catch {
						toast.error("Failed to update assignments");
					}
				}}
				data-testid="marketplace-save-assignments"
			>
				Save assignments
			</Button>
		</div>
	);
}

import { Label } from "@/components/ui/label";
import { ComboboxSelect } from "@/components/ui/combobox";
import { useT } from "@/lib/i18n";
import { useListAoneUsersQuery } from "@/lib/store/apis/aoneUsersApi";
import { useGetMarketplaceItemAssignmentsQuery } from "@/lib/store/apis/marketplaceApi";
import { Building2, Users } from "lucide-react";
import { useEffect, useMemo, useRef } from "react";
import { AoneDepartmentTreeSelect } from "./aoneDepartmentTreeSelect";

export type MarketplaceAssignmentSelection = {
	users: string[];
	departments: string[];
};

export function MarketplaceItemAssignmentsSection({
	itemId,
	value,
	onChange,
}: {
	itemId?: number;
	value: MarketplaceAssignmentSelection;
	onChange: (next: MarketplaceAssignmentSelection) => void;
}) {
	const t = useT();
	const { data: usersData } = useListAoneUsersQuery({ limit: 500 });
	const { data: assignmentsData, isLoading: assignmentsLoading } = useGetMarketplaceItemAssignmentsQuery(itemId ?? 0, {
		skip: !itemId,
	});
	const loadedItemIdRef = useRef<number | null>(null);

	useEffect(() => {
		loadedItemIdRef.current = null;
	}, [itemId]);

	useEffect(() => {
		if (!itemId || !assignmentsData || loadedItemIdRef.current === itemId) {
			return;
		}
		loadedItemIdRef.current = itemId;
		onChange({
			users: assignmentsData.users ?? [],
			departments: assignmentsData.departments ?? [],
		});
	}, [assignmentsData, itemId, onChange]);

	const userOptions = useMemo(
		() =>
			(usersData?.users ?? []).map((user) => ({
				value: user.id,
				label: user.display_name || user.name || user.email || user.id,
			})),
		[usersData?.users],
	);

	return (
		<div className="grid gap-4 rounded-lg border p-4" data-testid="marketplace-item-assignments">
			<div>
				<p className="text-sm font-medium">{t("marketplace.assignments.title")}</p>
				<p className="text-muted-foreground text-xs">{t("marketplace.assignments.itemHint")}</p>
			</div>
			{itemId && assignmentsLoading ? <p className="text-muted-foreground text-sm">{t("marketplace.assignments.loading")}</p> : null}
			<div className="grid gap-2">
				<Label className="flex items-center gap-2">
					<Users className="size-4" />
					{t("marketplace.assignments.users")}
				</Label>
				<div data-testid="marketplace-assign-users">
					<ComboboxSelect
						multiple
						value={value.users}
						onValueChange={(users) => onChange({ ...value, users })}
						options={userOptions}
						placeholder={t("marketplace.assignments.usersPlaceholder")}
					/>
				</div>
			</div>
			<div className="grid gap-2">
				<Label className="flex items-center gap-2">
					<Building2 className="size-4" />
					{t("marketplace.assignments.departments")}
				</Label>
				<AoneDepartmentTreeSelect value={value.departments} onChange={(departments) => onChange({ ...value, departments })} />
			</div>
		</div>
	);
}
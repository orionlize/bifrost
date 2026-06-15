/**
 * Operator Selector Component for CEL Rule Builder
 * Allows selection of operators for CEL expressions
 */

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { celBuilderT, type CelBuilderI18nContext } from "./i18n";
import { OperatorSelectorProps } from "react-querybuilder";

export function OperatorSelector({ value, handleOnChange, options, context }: OperatorSelectorProps & { context?: CelBuilderI18nContext }) {
	return (
		<Select value={value || ""} onValueChange={handleOnChange}>
			<SelectTrigger className="w-[160px]">
				<SelectValue placeholder={celBuilderT(context, "routing.celBuilder.selectOperator")} />
			</SelectTrigger>
			<SelectContent>
				{options.map((option) => {
					// Handle option groups (not currently used, but type-safe)
					if ("options" in option) {
						return null;
					}
					// Handle regular options - skip empty values
					if (!option.name) {
						return null;
					}
					return (
						<SelectItem key={option.name} value={option.name} disabled={option.disabled}>
							{option.label}
						</SelectItem>
					);
				})}
			</SelectContent>
		</Select>
	);
}
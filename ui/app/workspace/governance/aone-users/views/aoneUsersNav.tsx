import { cn } from "@/lib/utils";
import { Link, useRouterState } from "@tanstack/react-router";
import { Laptop, UserRound } from "lucide-react";

const tabs = [
	{
		label: "Users",
		to: "/workspace/governance/aone-users",
		icon: UserRound,
		testId: "aone-users-nav-users",
	},
	{
		label: "Devices",
		to: "/workspace/governance/aone-devices",
		icon: Laptop,
		testId: "aone-users-nav-devices",
	},
] as const;

export function AoneUsersNav() {
	const pathname = useRouterState({ select: (state) => state.location.pathname });

	return (
		<nav className="flex flex-wrap gap-2" aria-label="Aone user management">
			{tabs.map((tab) => {
				const active = pathname === tab.to;
				const Icon = tab.icon;
				return (
					<Link
						key={tab.to}
						to={tab.to}
						data-testid={tab.testId}
						className={cn(
							"inline-flex items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors",
							active
								? "bg-primary text-primary-foreground border-primary"
								: "text-muted-foreground hover:bg-muted/60 hover:text-foreground bg-background",
						)}
					>
						<Icon className="size-4" />
						{tab.label}
					</Link>
				);
			})}
		</nav>
	);
}
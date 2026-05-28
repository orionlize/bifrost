import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getErrorMessage, useIsAuthEnabledQuery, useLoginMutation } from "@/lib/store/apis";
import { DEFAULT_POST_LOGIN_PATH, normalizeLoginGoto } from "@/lib/utils/loginGoto";
import { BooksIcon, DiscordLogoIcon, GithubLogoIcon } from "@phosphor-icons/react";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { Eye, EyeOff } from "lucide-react";
import { useTheme } from "next-themes";
import { useEffect, useMemo, useState } from "react";

const externalLinks = [
	{
		title: "Discord Server",
		url: "https://discord.gg/exN5KAydbU",
		icon: DiscordLogoIcon,
	},
	{
		title: "GitHub Repository",
		url: "https://github.com/maximhq/bifrost",
		icon: GithubLogoIcon,
	},
	{
		title: "Full Documentation",
		url: "https://docs.getbifrost.ai",
		icon: BooksIcon,
		strokeWidth: 1,
	},
];

export default function LoginView() {
	const { resolvedTheme } = useTheme();
	const [mounted, setMounted] = useState(false);
	const [username, setUsername] = useState("");
	const [password, setPassword] = useState("");
	const [showPassword, setShowPassword] = useState(false);
	const [errorMessage, setErrorMessage] = useState("");
	const navigate = useNavigate();
	const search = useSearch({ strict: false }) as { error?: string; goto?: string };
	const [isLoading, setIsLoading] = useState(false);
	const [login, { isLoading: isLoggingIn }] = useLoginMutation();
	const { data: authState } = useIsAuthEnabledQuery();
	const aoneOAuthEnabled = authState?.aone_oauth_enabled === true;
	const showPasswordForm = authState?.is_auth_enabled === true;

	useEffect(() => {
		setMounted(true);
	}, []);

	useEffect(() => {
		if (search.error) {
			setErrorMessage(search.error);
		}
	}, [search.error]);

	const postLoginPath = normalizeLoginGoto(search.goto) ?? DEFAULT_POST_LOGIN_PATH;
	const aoneAuthorizeUrl = useMemo(() => {
		if (typeof window === "undefined") {
			return `/api/aone/oauth/authorize?return_to=${encodeURIComponent(DEFAULT_POST_LOGIN_PATH)}`;
		}
		const returnTo = encodeURIComponent(`${window.location.origin}${postLoginPath}`);
		return `/api/aone/oauth/authorize?return_to=${returnTo}`;
	}, [postLoginPath]);

	const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
		setIsLoading(true);
		e.preventDefault();
		setErrorMessage("");
		try {
			await login({ username, password }).unwrap();
			navigate({ to: "/workspace" });
		} catch (error) {
			const message = getErrorMessage(error);
			setErrorMessage(message);
		} finally {
			setIsLoading(false);
		}
	};

	const logoSrc = mounted && resolvedTheme === "dark" ? "/bifrost-logo-dark.webp" : "/bifrost-logo.webp";

	return (
		<div className="flex min-h-screen items-center justify-center p-4">
			<div className="w-full max-w-md">
				<div className="border-border bg-card w-full space-y-6 rounded-sm border p-8">
					{/* Logo */}
					<div className="flex items-center justify-center">
						<img src={logoSrc} alt="Bifrost" width={160} height={26} className="" />
					</div>

					<div className="space-y-2 text-center">
						<h1 className="text-foreground text-lg font-semibold">Welcome back</h1>
						<p className="text-muted-foreground text-sm">Sign in to your account to continue</p>
					</div>

					<form onSubmit={handleSubmit} className="space-y-5">
						{errorMessage && <div className="bg-destructive/10 text-destructive rounded-sm p-3 text-sm">{errorMessage}</div>}

						{aoneOAuthEnabled && (
							<Button
								type="button"
								variant="outline"
								className="h-9 w-full text-sm"
								onClick={() => {
									window.location.href = aoneAuthorizeUrl;
								}}
								data-testid="login-aone-oauth-button"
							>
								Sign in with Aone
							</Button>
						)}

						{aoneOAuthEnabled && showPasswordForm && (
							<div className="relative">
								<div className="absolute inset-0 flex items-center">
									<span className="w-full border-t" />
								</div>
								<div className="relative flex justify-center text-xs uppercase">
									<span className="bg-card text-muted-foreground px-2">Or continue with password</span>
								</div>
							</div>
						)}

						{showPasswordForm && (
							<>
						<div className="space-y-2">
							<Label htmlFor="username" className="text-sm font-medium">
								Username
							</Label>
							<Input
								id="username"
								type="text"
								placeholder="Enter your username"
								value={username}
								onChange={(e) => setUsername(e.target.value)}
								required
								className="text-sm"
								autoComplete="username"
							/>
						</div>

						<div className="space-y-2">
							<Label htmlFor="password" className="text-sm font-medium">
								Password
							</Label>
							<div className="relative">
								<Input
									id="password"
									type={showPassword ? "text" : "password"}
									placeholder="Enter your password"
									value={password}
									onChange={(e) => setPassword(e.target.value)}
									required
									className="pr-10 text-sm"
									autoComplete="current-password"
								/>
								<button
									type="button"
									onClick={() => setShowPassword(!showPassword)}
									className="text-muted-foreground hover:text-foreground absolute top-1/2 right-3 -translate-y-1/2 transition-colors"
									aria-label={showPassword ? "Hide password" : "Show password"}
								>
									{showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
								</button>
							</div>
						</div>

						<Button type="submit" className="h-9 w-full text-sm" isLoading={isLoading} disabled={isLoading}>
							{isLoading || isLoggingIn ? "Signing in..." : "Sign in"}
						</Button>
							</>
						)}
					</form>

					{/* Social Links */}
					<div className="flex items-center justify-center gap-4 pt-4">
						{externalLinks.map((item, index) => (
							<a
								key={index}
								href={item.url}
								target="_blank"
								rel="noopener noreferrer"
								className="text-muted-foreground hover:text-primary transition-colors"
								title={item.title}
							>
								<item.icon className="h-5 w-5" size={20} weight="regular" strokeWidth={item.strokeWidth} />
							</a>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
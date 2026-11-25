import { useRef, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { Button } from "@groot/ui/button";
import { displayClass, h1Class } from "@groot/ui/typography";
import { Input } from "@groot/ui/input";
import { LoadingSpinner } from "@groot/ui/loading-spinner";
import { Form, FormField } from "@groot/ui/form";
import { loginErrorDescription, useAuthStore } from "@groot/shell/store/auth";
import { type LoginFeature, useShellConfig } from "@groot/shell/lib/shell-config";
import { useSetupStatus } from "@groot/shell/hooks/useSetupStatus";
import type { z } from "zod";
import { loginSchema } from "@groot/core/auth/auth.schema";
import { toast } from "sonner";
import { LayoutDashboard, ShieldCheck, Zap, ArrowRight, KeyRound, Loader2 } from "lucide-react";

const isDev = import.meta.env.DEV;

const DEMO_CREDENTIALS = { email: "demo@example.com", password: "demo@example.com" }; // gitleaks:allow

type LoginValues = z.infer<typeof loginSchema>;

export { loginErrorDescription };

const FEATURES = [
  {
    icon: Zap,
    title: "Built for speed",
    desc: "Hono on Node or Workers, React with HMR out of the box.",
  },
  {
    icon: ShieldCheck,
    title: "Secure by default",
    desc: "Cookie sessions, passkeys, and rate-limited sign-in.",
  },
  { icon: LayoutDashboard, title: "Production UI", desc: "A polished sidebar shell you can ship." },
] satisfies LoginFeature[];

export function returnPath(state: unknown): string {
  const from = (state as { from?: { pathname?: unknown; search?: unknown; hash?: unknown } })?.from;
  if (!from || typeof from.pathname !== "string" || !from.pathname.startsWith("/")) return "/";
  if (from.pathname.startsWith("//") || from.pathname === "/login") return "/";
  const search = typeof from.search === "string" ? from.search : "";
  const hash = typeof from.hash === "string" ? from.hash : "";
  return `${from.pathname}${search}${hash}`;
}

type SignInMethod = "password" | "passkey";

type SignInState = { status: "idle" } | { status: "running"; method: SignInMethod };

const SIGN_IN_FAILURE: Record<SignInMethod, { title: string; fallback: string }> = {
  password: { title: "Login Failed", fallback: "Invalid credentials" },
  passkey: { title: "Passkey Sign-In Failed", fallback: "Passkey authentication failed" },
};

export function Login() {
  const login = useAuthStore((state) => state.login);
  const loginWithPasskey = useAuthStore((state) => state.loginWithPasskey);
  const navigate = useNavigate();
  const location = useLocation();
  const destination = returnPath(location.state);
  const config = useShellConfig();
  const { icon: BrandMark, label: brandLabel } = config.brand;
  const tagline = config.login?.tagline ?? "The boilerplate that ships like a product.";
  const description =
    config.login?.description ??
    "Everything you need to launch a full-stack SaaS (auth, storage, background jobs, and a polished UI) without the busywork.";
  const features = config.login?.features ?? FEATURES;
  const needsSetup = useSetupStatus();

  const [signIn, setSignIn] = useState<SignInState>({ status: "idle" });

  const running = useRef(false);

  const runSignIn = async (method: SignInMethod, attempt: () => Promise<unknown>) => {
    if (running.current) return;
    running.current = true;
    setSignIn({ status: "running", method });
    try {
      await attempt();
      navigate(destination, { replace: true });
    } catch (error) {
      const { title, fallback } = SIGN_IN_FAILURE[method];
      toast.error(title, { description: loginErrorDescription(error, fallback) });
    } finally {
      running.current = false;
      setSignIn({ status: "idle" });
    }
  };

  const onSubmit = (values: LoginValues) =>
    runSignIn("password", () => login(values.email, values.password));
  const handlePasskeyLogin = () => runSignIn("passkey", loginWithPasskey);
  const busyWith = signIn.status === "running" ? signIn.method : null;

  if (needsSetup === undefined) {
    return (
      <div className="flex min-h-dvh items-center justify-center bg-muted/40">
        <LoadingSpinner size="md" />
      </div>
    );
  }
  if (needsSetup) return <Navigate to="/setup" replace />;

  return (
    <div className="flex min-h-dvh bg-background">
      <div className="flex w-full flex-col justify-center px-6 py-12 sm:px-12 lg:w-1/2 lg:px-16">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <BrandMark className="size-5" />
            </span>
            <span className="font-heading text-base font-semibold">{brandLabel}</span>
          </div>

          <h1 className={h1Class}>Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your account to continue.</p>

          {isDev && (
            <div className="mt-6 rounded-xl border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Demo credentials:</span>{" "}
              demo@example.com / demo@example.com
            </div>
          )}

          <Form
            schema={loginSchema}
            defaultValues={isDev ? DEMO_CREDENTIALS : { email: "", password: "" }}
            onSubmit={onSubmit}
            className="mt-6 space-y-4"
          >
            <FormField name="email" label="Email">
              <Input type="email" autoComplete="username" placeholder="you@example.com" />
            </FormField>
            <FormField name="password" label="Password">
              <Input type="password" autoComplete="current-password" placeholder="••••••••" />
            </FormField>
            <Button
              type="submit"
              size="lg"
              className="w-full"
              disabled={busyWith !== null}
              aria-busy={busyWith === "password"}
            >
              {busyWith === "password" ? "Signing in…" : "Sign In"}
              {busyWith === "password" ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <ArrowRight className="size-4" />
              )}
            </Button>
          </Form>

          <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
            <div className="h-px flex-1 bg-border" />
            <span>or</span>
            <div className="h-px flex-1 bg-border" />
          </div>

          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="w-full"
            onClick={() => void handlePasskeyLogin()}
            disabled={busyWith !== null}
            aria-busy={busyWith === "passkey"}
          >
            {busyWith === "passkey" ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <KeyRound className="size-4" />
            )}
            {busyWith === "passkey" ? "Waiting for passkey…" : "Sign in with passkey"}
          </Button>
        </div>
      </div>

      <div className="bg-primary dark:bg-card relative hidden overflow-hidden lg:flex lg:w-1/2 lg:flex-col lg:justify-center lg:px-16">
        <div
          className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: "radial-gradient(circle at 1px 1px, currentColor 1px, transparent 0)",
            backgroundSize: "32px 32px",
          }}
        />
        <div className="text-primary-foreground dark:text-foreground relative max-w-md">
          <h2 className={displayClass}>{tagline}</h2>
          <p className="text-primary-foreground/70 dark:text-foreground/70 mt-3 text-sm">
            {description}
          </p>
          <ul className="mt-8 space-y-4">
            {features.map((f) => (
              <li key={f.title} className="flex items-start gap-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary-foreground/10 dark:bg-foreground/10">
                  <f.icon className="size-4 text-primary-foreground dark:text-foreground" />
                </span>
                <div>
                  <p className="text-primary-foreground dark:text-foreground text-sm font-medium">
                    {f.title}
                  </p>
                  <p className="text-primary-foreground/60 dark:text-foreground/60 text-sm">
                    {f.desc}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

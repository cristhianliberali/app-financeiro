import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth, useAuthConfig } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth")({
  head: () => ({
    meta: [
      { title: "Entrar — Aura Finanças" },
      {
        name: "description",
        content: "Acesse sua conta Aura para gerir gastos mensais, orçamentos e economias.",
      },
      { property: "og:title", content: "Entrar — Aura Finanças" },
      {
        property: "og:description",
        content: "Acesse sua conta Aura para gerir gastos mensais, orçamentos e economias.",
      },
    ],
  }),
  component: AuthPage,
});

function AuthPage() {
  const navigate = useNavigate();
  const { user, loading, signIn, signUp } = useAuth();
  // `CREATE_USERS_HOME=false` no servidor esconde o cadastro daqui e faz o
  // back-end recusar qualquer tentativa — o app passa a ser só por convite.
  const { data: config } = useAuthConfig();
  const signupEnabled = config?.signupEnabled ?? false;

  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/" });
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!signupEnabled && mode === "signup") setMode("login");
  }, [signupEnabled, mode]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "login") await signIn(email, password);
      else await signUp(email, password, name);
      navigate({ to: "/" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível continuar");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="size-8 rounded-lg bg-primary" />
          <span className="text-xl font-bold tracking-tight">AURA</span>
        </div>
        <h1 className="text-2xl font-bold tracking-tight">
          {mode === "login" ? "Entrar na sua conta" : "Criar sua conta"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Gestão de gastos, orçamentos e economias em um só lugar.
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {mode === "signup" && (
            <div className="space-y-1.5">
              <Label htmlFor="name">Nome</Label>
              <Input
                id="name"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {mode === "signup" && (
              <p className="text-xs text-muted-foreground">Use pelo menos 8 caracteres.</p>
            )}
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {mode === "login" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        {signupEnabled ? (
          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="mt-6 w-full text-center text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            {mode === "login" ? "Não tem conta? Criar agora" : "Já tem conta? Entrar"}
          </button>
        ) : (
          <p className="mt-6 text-center text-xs text-muted-foreground">
            O cadastro está fechado. Peça um convite a quem já usa o app.
          </p>
        )}
      </div>
    </div>
  );
}

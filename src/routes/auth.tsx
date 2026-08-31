import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth, useAuthConfig } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sparkles } from "lucide-react";

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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-10">
      {/*
        Dois halos da marca ao fundo. Ficam atrás do cartão e bem desfocados:
        dão profundidade à tela de entrada sem disputar leitura com o formulário.
      */}
      <span className="pointer-events-none absolute -left-32 -top-32 size-96 rounded-full bg-primary/20 blur-3xl" />
      <span className="pointer-events-none absolute -bottom-32 -right-32 size-96 rounded-full bg-accent-2/20 blur-3xl" />

      <div className="panel relative w-full max-w-sm p-8 shadow-xl">
        <div className="mb-7 flex items-center gap-2.5">
          <span className="brand-gradient flex size-10 items-center justify-center rounded-xl shadow-glow">
            <Sparkles className="size-5" strokeWidth={2.5} />
          </span>
          <span className="flex flex-col leading-none">
            <span className="text-xl font-extrabold tracking-tight">AURA</span>
            <span className="label-caps text-[0.6rem]">Finanças &amp; Projetos</span>
          </span>
        </div>
        <h1 className="title-xl">{mode === "login" ? "Entrar na sua conta" : "Criar sua conta"}</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          Gestão de gastos, orçamentos e economias em um só lugar.
        </p>

        <form onSubmit={submit} className="mt-7 space-y-4">
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
          <Button type="submit" variant="brand" size="lg" className="w-full" disabled={busy}>
            {busy ? "Aguarde…" : mode === "login" ? "Entrar" : "Criar conta"}
          </Button>
        </form>

        {mode === "login" && (
          <Link
            to="/redefinir-senha"
            search={{}}
            className="mt-4 block w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
          >
            Esqueci minha senha
          </Link>
        )}

        {signupEnabled ? (
          <button
            onClick={() => setMode(mode === "login" ? "signup" : "login")}
            className="mt-6 w-full text-center text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
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

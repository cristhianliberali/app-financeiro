import { useNavigate } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { useAcesso } from "@/hooks/usePlano";

/**
 * Segura o conteúdo do app enquanto o plano não libera.
 *
 * Fica dentro das duas cascas (Finanças e Tarefas) porque os dois módulos são o
 * produto pago. O que continua aberto a quem está bloqueado é o cadastro
 * (`/conta`), a saída (`/auth`) e a tela que explica o bloqueio
 * (`/assinatura`) — trancar essas seria trancar a pessoa longe justamente da
 * tela que existe para ela voltar a pagar.
 *
 * A decisão real é do servidor; aqui é a versão visível dela.
 */
export function PlanoGate({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const { data: acesso, isPending, isError } = useAcesso();

  useEffect(() => {
    if (!isPending && !isError && acesso && !acesso.liberado) {
      navigate({ to: "/assinatura" });
    }
  }, [acesso, isPending, isError, navigate]);

  // Enquanto não se sabe, não se mostra: piscar o app inteiro por meio segundo
  // antes de bloquear é pior do que esperar.
  if (isPending || (acesso && !acesso.liberado)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3">
        <span className="size-9 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm text-muted-foreground">Carregando…</p>
      </div>
    );
  }

  return <>{children}</>;
}

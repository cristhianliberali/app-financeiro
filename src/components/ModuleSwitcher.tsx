import { Link, useRouterState } from "@tanstack/react-router";
import { KanbanSquare, Wallet } from "lucide-react";

/**
 * Alternador entre os dois módulos do app: Finanças e Projetos e Tarefas.
 *
 * Cada módulo tem sua própria casca (`AppShell` e `TasksShell`), então este é o
 * único ponto de passagem entre eles — mudar rótulo, ordem ou destino aqui muda
 * em todas as telas.
 */
export const MODULES = [
  {
    to: "/",
    label: "Finanças",
    icon: Wallet,
    match: (path: string) => !path.startsWith("/tarefas"),
  },
  {
    to: "/tarefas",
    label: "Projetos e Tarefas",
    icon: KanbanSquare,
    match: (path: string) => path.startsWith("/tarefas"),
  },
] as const;

export function ModuleSwitcher({
  /** Só os ícones, para a lateral recolhida. */
  collapsed = false,
  /**
   * Empilhado é o padrão das laterais: "Projetos e Tarefas" não cabe lado a
   * lado com "Finanças" em 288px sem cortar o rótulo. Horizontal é para o
   * cabeçalho, onde sobra largura.
   */
  orientation = "vertical",
}: {
  collapsed?: boolean;
  orientation?: "vertical" | "horizontal";
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const stacked = collapsed || orientation === "vertical";

  return (
    <div
      className={`flex rounded-xl border border-border bg-secondary p-1 ${
        stacked ? "flex-col gap-1" : "gap-1"
      }`}
      role="group"
      aria-label="Módulo"
    >
      {MODULES.map((module) => {
        const active = module.match(pathname);
        return (
          <Link
            key={module.to}
            to={module.to}
            title={module.label}
            className={`flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2.5 py-2 text-xs font-semibold transition-all ${
              collapsed ? "justify-center" : ""
            } ${
              active
                ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
            }`}
          >
            <module.icon
              className={`size-4 shrink-0 ${active ? "text-primary" : ""}`}
              strokeWidth={2.25}
            />
            {!collapsed && <span className="truncate">{module.label}</span>}
          </Link>
        );
      })}
    </div>
  );
}

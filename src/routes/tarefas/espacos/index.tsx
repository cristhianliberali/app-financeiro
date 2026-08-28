import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Archive, Pencil, Plus } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { SpaceDialog } from "@/components/tasks/SpaceDialog";
import { useTasksModule } from "@/components/tasks/useTasksModule";
import { useBoards, useSpaces, useTasks, type Space } from "@/lib/tasks";

export const Route = createFileRoute("/tarefas/espacos/")({
  head: () => ({
    meta: [
      { title: "Espaços — Tarefas e Projetos" },
      {
        name: "description",
        content:
          "Organize projetos, departamentos e áreas em espaços, cada um agrupando seus próprios quadros.",
      },
    ],
  }),
  component: SpacesPage,
});

function SpacesPage() {
  const { accountId, users } = useTasksModule();
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId });
  const { data: tasks = [] } = useTasks({ accountId });
  const [dialog, setDialog] = useState<{ open: boolean; space: Space | null }>({
    open: false,
    space: null,
  });

  const active = spaces.filter((s) => !s.archived_at);
  const archived = spaces.filter((s) => s.archived_at);

  const card = (space: Space) => {
    const spaceBoards = boards.filter((b) => b.space_id === space.id);
    const spaceTasks = tasks.filter((t) => t.space.id === space.id);
    const open = spaceTasks.filter((t) => t.status?.polarity === "IN_PROGRESS").length;
    return (
      <div
        key={space.id}
        className="group relative rounded-2xl border border-border bg-card p-5 transition-shadow hover:shadow-md"
      >
        <button
          onClick={() => setDialog({ open: true, space })}
          className="absolute right-3 top-3 rounded p-1.5 text-muted-foreground opacity-0 transition-opacity hover:bg-secondary hover:text-foreground group-hover:opacity-100"
          aria-label={`Editar ${space.name}`}
        >
          <Pencil className="size-3.5" />
        </button>
        <Link to="/tarefas/espacos/$spaceId" params={{ spaceId: space.id }} className="block">
          <div className="flex items-center gap-3">
            <span
              className="flex size-11 items-center justify-center rounded-xl text-xl"
              style={{ backgroundColor: `${space.color}1A` }}
            >
              {space.icon}
            </span>
            <div>
              <p className="font-semibold">{space.name}</p>
              <p className="text-xs text-muted-foreground">
                {spaceBoards.length} {spaceBoards.length === 1 ? "quadro" : "quadros"}
              </p>
            </div>
          </div>
          {space.description && (
            <p className="mt-3 line-clamp-2 text-sm text-muted-foreground">{space.description}</p>
          )}
          <div className="mt-4 flex items-center gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-mono font-semibold text-foreground">{spaceTasks.length}</span>{" "}
              tarefas
            </span>
            <span>
              <span className="font-mono font-semibold text-primary">{open}</span> em andamento
            </span>
          </div>
          {spaceBoards.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {spaceBoards.slice(0, 4).map((b) => (
                <span
                  key={b.id}
                  className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground"
                >
                  {b.name}
                </span>
              ))}
              {spaceBoards.length > 4 && (
                <span className="text-[11px] text-muted-foreground">+{spaceBoards.length - 4}</span>
              )}
            </div>
          )}
        </Link>
      </div>
    );
  };

  return (
    <AppShell
      hideFinanceControls
      actions={
        <Button size="sm" onClick={() => setDialog({ open: true, space: null })}>
          <Plus className="mr-1 size-3.5" /> Novo espaço
        </Button>
      }
    >
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Espaços</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          O espaço é o nível mais alto da organização: agrupa departamentos, áreas ou grandes
          contextos, e cada espaço contém seus próprios quadros.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{active.map(card)}</div>

      {active.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border p-10 text-center">
          <p className="text-sm text-muted-foreground">
            Nenhum espaço criado ainda. Comece por áreas como Marketing, Comercial, Desenvolvimento
            ou Financeiro.
          </p>
          <Button className="mt-4" onClick={() => setDialog({ open: true, space: null })}>
            <Plus className="mr-1 size-3.5" /> Criar primeiro espaço
          </Button>
        </div>
      )}

      {archived.length > 0 && (
        <div className="space-y-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <Archive className="size-4" /> Arquivados
          </h2>
          <div className="grid gap-4 opacity-60 sm:grid-cols-2 lg:grid-cols-3">
            {archived.map(card)}
          </div>
        </div>
      )}

      <SpaceDialog
        open={dialog.open}
        onOpenChange={(open) => setDialog({ open, space: open ? dialog.space : null })}
        accountId={accountId}
        space={dialog.space}
        users={users}
      />
    </AppShell>
  );
}

import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Check, ChevronDown, Home } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useBoards, useSpaces } from "@/lib/tasks";
import { useAppState } from "@/lib/app-state";
import { useTone } from "@/hooks/use-tone";
import { DEFAULT_SPACE_ICON, IconBadge } from "@/lib/icons";

/**
 * Navegação hierárquica: Espaço / Quadro.
 *
 * Cada nível é ao mesmo tempo um link para a própria tela e um seletor — a seta
 * abre a lista de irmãos daquele nível, então dá para pular de um quadro para
 * outro (ou de espaço) sem voltar até a listagem.
 */
export function TasksBreadcrumb({
  spaceId = null,
  boardId = null,
  /** Último nível quando não há espaço/quadro: "Minhas tarefas", "Calendário"… */
  current,
}: {
  spaceId?: string | null;
  boardId?: string | null;
  current?: string;
}) {
  const { accountId } = useAppState();
  const navigate = useNavigate();
  const { data: spaces = [] } = useSpaces(accountId);
  const { data: boards = [] } = useBoards({ accountId, spaceId });
  const [openLevel, setOpenLevel] = useState<"space" | "board" | null>(null);
  const tone = useTone();

  const space = spaces.find((s) => s.id === spaceId) ?? null;
  const board = boards.find((b) => b.id === boardId) ?? null;
  const activeSpaces = spaces.filter((s) => !s.archived_at || s.id === spaceId);
  const activeBoards = boards.filter((b) => !b.archived_at || b.id === boardId);

  return (
    <nav aria-label="Navegação hierárquica" className="flex min-w-0 items-center gap-1 text-sm">
      <Link
        to="/tarefas"
        className="flex shrink-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        title="Visão geral de Projetos e Tarefas"
      >
        <Home className="size-3.5" />
        <span className="hidden sm:inline">Projetos</span>
      </Link>

      {space && (
        <>
          <Separator />
          <div className="flex min-w-0 items-center rounded-md">
            <Link
              to="/tarefas/espacos/$spaceId"
              params={{ spaceId: space.id }}
              className="flex min-w-0 items-center gap-1.5 rounded-l-md px-1.5 py-1 transition-colors hover:bg-secondary"
            >
              <IconBadge
                name={space.icon}
                color={space.color}
                size="sm"
                fallback={DEFAULT_SPACE_ICON}
              />
              <span className={`truncate ${board ? "text-muted-foreground" : "font-semibold"}`}>
                {space.name}
              </span>
            </Link>
            <LevelPicker
              open={openLevel === "space"}
              onOpenChange={(open) => setOpenLevel(open ? "space" : null)}
              ariaLabel="Trocar de espaço"
              emptyText="Nenhum outro espaço"
              items={activeSpaces.map((option) => ({
                id: option.id,
                label: option.name,
                prefix: (
                  <IconBadge
                    name={option.icon}
                    color={option.color}
                    size="sm"
                    fallback={DEFAULT_SPACE_ICON}
                  />
                ),
                active: option.id === space.id,
                onSelect: () =>
                  navigate({
                    to: "/tarefas/espacos/$spaceId",
                    params: { spaceId: option.id },
                  }),
              }))}
            />
          </div>
        </>
      )}

      {space && board && (
        <>
          <Separator />
          <div className="flex min-w-0 items-center rounded-md">
            <Link
              to="/tarefas/quadros/$boardId"
              params={{ boardId: board.id }}
              search={{}}
              className="flex min-w-0 items-center gap-1.5 rounded-l-md px-1.5 py-1 transition-colors hover:bg-secondary"
            >
              <span
                className="size-2 shrink-0 rounded-full ring-1 ring-border"
                style={{ backgroundColor: tone(board.color) }}
              />
              <span className="truncate font-semibold">{board.name}</span>
            </Link>
            <LevelPicker
              open={openLevel === "board"}
              onOpenChange={(open) => setOpenLevel(open ? "board" : null)}
              ariaLabel="Trocar de quadro"
              emptyText="Nenhum outro quadro neste espaço"
              items={activeBoards.map((option) => ({
                id: option.id,
                label: option.name,
                color: tone(option.color),
                active: option.id === board.id,
                onSelect: () =>
                  navigate({
                    to: "/tarefas/quadros/$boardId",
                    params: { boardId: option.id },
                    search: {},
                  }),
              }))}
            />
          </div>
        </>
      )}

      {current && (
        <>
          <Separator />
          <span className="truncate px-1.5 py-1 font-semibold">{current}</span>
        </>
      )}
    </nav>
  );
}

const Separator = () => (
  <span className="shrink-0 select-none text-muted-foreground" aria-hidden>
    /
  </span>
);

type PickerItem = {
  id: string;
  label: string;
  prefix?: React.ReactNode;
  color?: string;
  active: boolean;
  onSelect: () => void;
};

function LevelPicker({
  open,
  onOpenChange,
  items,
  ariaLabel,
  emptyText,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: PickerItem[];
  ariaLabel: string;
  emptyText: string;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          className="rounded-r-md px-1 py-1.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={ariaLabel}
          title={ariaLabel}
        >
          <ChevronDown className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1">
        <div className="max-h-72 space-y-0.5 overflow-y-auto thin-scrollbar">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                onOpenChange(false);
                item.onSelect();
              }}
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary ${
                item.active ? "font-semibold" : ""
              }`}
            >
              {item.prefix}
              {item.color && (
                <span
                  className="size-2 shrink-0 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: item.color }}
                />
              )}
              <span className="flex-1 truncate">{item.label}</span>
              {item.active && <Check className="size-3.5 shrink-0" />}
            </button>
          ))}
          {items.length === 0 && (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">{emptyText}</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

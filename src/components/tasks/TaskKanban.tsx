import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useTone } from "@/hooks/use-tone";
import type { AccountUser, Task } from "@/lib/tasks";
import { TaskCard } from "./TaskCard";

export type KanbanColumn = {
  id: string;
  name: string;
  color: string;
  /** Explicação da coluna, no title do cabeçalho. */
  hint?: string;
};

/** Folga entre o fim do quadro e a borda de baixo da janela. */
const BOTTOM_GAP = 20;
/** Altura mínima, para o quadro não sumir numa janela baixa. */
const MIN_HEIGHT = 320;

/**
 * Estica o quadro até o rodapé da janela.
 *
 * Um Kanban que termina onde termina a última tarefa deixa um vazio embaixo e
 * encolhe a área onde se solta o cartão. Medindo onde ele começa dá para dizer
 * exatamente quanto falta até o fim da tela — e a coluna vazia continua sendo
 * uma coluna inteira, não uma tarja.
 */
function useFillHeight() {
  // Ref de callback, e não `useRef`: enquanto os status não chegam o quadro
  // renderiza o aviso de "sem status" e o elemento medido nem existe. Guardar
  // o nó em estado é o que faz a medição acontecer quando ele enfim monta.
  const [element, setElement] = useState<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!element) return;

    const measure = () => {
      const top = element.getBoundingClientRect().top;
      const next = Math.max(MIN_HEIGHT, Math.round(window.innerHeight - top - BOTTOM_GAP));
      // Só reage a mudança de verdade: sem isso, a própria altura que
      // acabamos de aplicar realimentaria o observador.
      setHeight((current) => (current !== null && Math.abs(current - next) < 2 ? current : next));
    };

    measure();
    window.addEventListener("resize", measure);
    // O cabeçalho da tela cresce quando os filtros quebram em duas linhas.
    const observer = new ResizeObserver(measure);
    if (element.parentElement) observer.observe(element.parentElement);
    return () => {
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, [element]);

  return { ref: setElement, height };
}

/**
 * Kanban com movimentação por arraste. Ao soltar o cartão em outra coluna o
 * status da tarefa é atualizado automaticamente.
 *
 * A coluna usa as mesmas peças do resto do sistema: superfície e borda
 * neutras, o nome em `label-caps` e o contador no selo cinza que a lateral já
 * usa. A cor do status entra num pontinho, do jeito que quadro e etiqueta
 * aparecem na árvore lateral e no caminho — é identificação suficiente, e
 * quatro colunas inteiras pintadas de vermelho, azul e verde competiam com as
 * tarefas, que são o que a tela tem para dizer. O destaque colorido fica para
 * o alvo do arraste, que é momentâneo e precisa saltar.
 *
 * O rodapé com "adicionar tarefa" fica preso embaixo, fora da rolagem: numa
 * coluna cheia ele não deve fugir junto com o último cartão.
 */
export function TaskKanban({
  columns,
  tasks,
  users,
  currentUserId,
  columnOf,
  onMove,
  onOpen,
  onToggleTimer,
  onAdd,
  showBoard = false,
}: {
  columns: KanbanColumn[];
  tasks: Task[];
  users: AccountUser[];
  currentUserId: string | null;
  columnOf: (task: Task) => string | null;
  onMove: (task: Task, columnId: string) => void;
  onOpen: (task: Task) => void;
  onToggleTimer: (task: Task) => void;
  onAdd?: (columnId: string) => void;
  showBoard?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const tone = useTone();
  const { ref, height } = useFillHeight();

  if (columns.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
        Este quadro ainda não possui status configurados.
      </div>
    );
  }

  return (
    <div
      ref={ref}
      className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1"
      style={height ? { height } : { minHeight: "70vh" }}
    >
      {columns.map((col) => {
        const items = tasks.filter((t) => columnOf(t) === col.id);
        const color = tone(col.color);
        const active = over === col.id;
        // Colunas vizinhas: é para elas que as setinhas do cartão empurram.
        const index = columns.indexOf(col);
        const prev = columns[index - 1];
        const next = columns[index + 1];
        return (
          <section
            key={col.id}
            className={`flex h-full w-[19.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border transition-colors ${
              active
                ? "border-primary bg-primary-soft ring-2 ring-ring/25"
                : "border-border bg-surface"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((c) => (c === col.id ? null : c))}
            onDrop={(e) => {
              e.preventDefault();
              setOver(null);
              const id = dragging ?? e.dataTransfer.getData("text/plain");
              const task = tasks.find((t) => t.id === id);
              setDragging(null);
              if (task && columnOf(task) !== col.id) onMove(task, col.id);
            }}
          >
            <header className="flex items-center gap-2 border-b border-border px-3 py-2.5">
              <span
                className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
                style={{ backgroundColor: color }}
                aria-hidden
              />
              <span className="label-caps truncate text-foreground" title={col.hint}>
                {col.name}
              </span>
              <span className="rounded-full bg-secondary px-2 py-0.5 font-mono text-[10px] font-bold text-muted-foreground">
                {items.length}
              </span>
              {onAdd && (
                <button
                  onClick={() => onAdd(col.id)}
                  className="ml-auto rounded-lg p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  aria-label={`Nova tarefa em ${col.name}`}
                  title={`Nova tarefa em ${col.name}`}
                >
                  <Plus className="size-4" />
                </button>
              )}
            </header>

            {/* Pilha em bloco, e não flex: como item de flex o cartão encolheria
                para caber, e a coluna cheia viraria uma sanfona. */}
            <div className="flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  users={users}
                  currentUserId={currentUserId}
                  showBoard={showBoard}
                  onOpen={() => onOpen(task)}
                  onToggleTimer={() => onToggleTimer(task)}
                  {...(prev
                    ? { onMovePrev: () => onMove(task, prev.id), prevName: prev.name }
                    : {})}
                  {...(next
                    ? { onMoveNext: () => onMove(task, next.id), nextName: next.name }
                    : {})}
                  onDragStart={(e) => {
                    setDragging(task.id);
                    e.dataTransfer.setData("text/plain", task.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                />
              ))}

              {items.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
                  {onAdd && (
                    <button
                      onClick={() => onAdd(col.id)}
                      className="flex size-11 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
                      aria-label={`Nova tarefa em ${col.name}`}
                    >
                      <Plus className="size-5" />
                    </button>
                  )}
                  <p className="text-xs font-medium text-muted-foreground">Nenhuma tarefa</p>
                  <p className="max-w-48 text-[11px] text-muted-foreground/70">
                    {onAdd ? "Solte aqui ou clique no + para adicionar" : "Arraste tarefas para cá"}
                  </p>
                </div>
              )}
            </div>

            {onAdd && (
              <div className="p-2 pt-0">
                <button
                  onClick={() => onAdd(col.id)}
                  className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" /> Adicionar tarefa
                </button>
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}

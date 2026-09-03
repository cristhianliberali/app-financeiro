import { useState } from "react";
import { Plus } from "lucide-react";
import { QuickTaskForm, type QuickTaskDraft } from "./QuickTaskForm";
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
  onQuickAdd,
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
  /**
   * Criação rápida na própria coluna. Quando existe, o rodapé e o vazio da
   * coluna abrem o formulário curto; o `+` do cabeçalho segue no completo.
   */
  onQuickAdd?: (columnId: string, draft: QuickTaskDraft) => Promise<void>;
  showBoard?: boolean;
}) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  /** Coluna com o formulário curto aberto — só uma por vez. */
  const [quick, setQuick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const tone = useTone();

  if (columns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center rounded-2xl border border-dashed border-border bg-card/50 p-12 text-center text-sm text-muted-foreground">
        Este quadro ainda não possui status configurados.
      </div>
    );
  }

  return (
    /*
      Altura pelo CSS, e não medida por JS.
      A versão anterior lia `getBoundingClientRect().top` e calculava o que
      sobrava até o fim da janela. Funcionava até a barra de filtros quebrar
      numa linha a mais — o que no celular é a regra, não a exceção: o valor
      medido virava passado, e a coluna encolhia ou estourava a tela. Como
      `flex-1` dentro da coluna de altura cheia da casca, o navegador refaz a
      conta sozinho a cada mudança de layout, e a coluna vazia continua sendo
      uma coluna inteira em vez de uma tarja.

      `min-h-72` é piso, não alvo: num telefone estreito a barra de filtros pode
      ocupar três linhas, e sem piso o quadro seria espremido a nada. Nesse caso
      ele mantém as 18rem e a casca rola — o único momento em que rolar a página
      é o comportamento certo.
    */
    <div className="-mx-1 flex min-h-72 flex-1 gap-3 overflow-x-auto px-1 pb-1">
      {columns.map((col) => {
        const items = tasks.filter((t) => columnOf(t) === col.id);
        const color = tone(col.color);
        const active = over === col.id;
        const quickOpen = onQuickAdd && quick === col.id;
        // Colunas vizinhas: é para elas que as setinhas do cartão empurram.
        const index = columns.indexOf(col);
        const prev = columns[index - 1];
        const next = columns[index + 1];
        return (
          <section
            key={col.id}
            /*
              Sem `h-full`: era ele que impedia a coluna de encher.
              Numa fila cuja altura vem do próprio flex, `height: 100%` não tem
              contra o que resolver e o navegador devolve a altura do conteúdo —
              a coluna parava no último cartão, com meia tela vazia embaixo. O
              `align-items: stretch`, que já é o padrão da fila, estica sozinho,
              e só funciona porque nenhuma altura explícita o atropela.
            */
            className={`flex min-h-0 w-[19.5rem] shrink-0 flex-col overflow-hidden rounded-2xl border transition-colors ${
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
                  aria-label={`Nova tarefa em ${col.name}, com todos os campos`}
                  title={`Nova tarefa em ${col.name}, com todos os campos`}
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

              {quickOpen && (
                <QuickTaskForm
                  users={users}
                  saving={saving}
                  onCancel={() => setQuick(null)}
                  onCreate={async (draft) => {
                    setSaving(true);
                    try {
                      await onQuickAdd(col.id, draft);
                      // Fecha ao gravar. Manter aberto para a próxima parecia
                      // economia, mas deixa um formulário em branco plantado no
                      // meio da coluna, que se confunde com um cartão. Quem vai
                      // criar outra clica de novo — é um clique, e a coluna
                      // volta a mostrar só tarefas.
                      setQuick(null);
                    } finally {
                      setSaving(false);
                    }
                  }}
                />
              )}

              {/*
                Logo abaixo do último cartão, e não preso no pé da coluna.
                Preso lá embaixo, numa coluna com duas tarefas, ele flutuava
                sozinho a meia tela de distância delas, e a relação entre "esta
                lista" e "acrescentar a ela" se perdia. Aqui ele acompanha a
                lista e some quando o formulário toma o lugar.
              */}
              {(onQuickAdd || onAdd) && !quickOpen && items.length > 0 && (
                <button
                  onClick={() => (onQuickAdd ? setQuick(col.id) : onAdd?.(col.id))}
                  className="flex w-full items-center gap-1.5 rounded-xl px-2.5 py-2 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <Plus className="size-3.5" /> Adicionar tarefa
                </button>
              )}

              {items.length === 0 && !quickOpen && (
                <div className="flex h-full flex-col items-center justify-center gap-2 py-8 text-center">
                  {(onQuickAdd || onAdd) && (
                    <button
                      onClick={() => (onQuickAdd ? setQuick(col.id) : onAdd?.(col.id))}
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
          </section>
        );
      })}
    </div>
  );
}

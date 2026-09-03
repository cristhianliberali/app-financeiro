import { useEffect, useRef, useState } from "react";
import { CalendarDays, CornerDownLeft, Loader2, UserRound, X } from "lucide-react";

import { DateField } from "@/components/ui/date-field";
import { UserSelect } from "./UserPicker";
import { dueFromDay } from "@/lib/tasks-analytics";
import type { AccountUser } from "@/lib/tasks";

/**
 * Criação rápida de tarefa, dentro da própria coluna do Kanban.
 *
 * Abrir o formulário inteiro para escrever "Ligar para o cliente" é caro: são
 * sete campos, um diálogo que cobre o quadro e a perda do lugar onde se estava.
 * Quem está organizando a semana quer despejar cinco tarefas numa coluna e
 * seguir. Aqui só existem os três campos que uma tarefa recém-nascida costuma
 * ter: o que é, de quem é e para quando é.
 *
 * O resto continua onde estava — o `+` do cabeçalho da coluna abre o formulário
 * completo, e clicar no cartão depois abre tudo. Isto é atalho, não substituto.
 */

export type QuickTaskDraft = {
  title: string;
  responsible_user_id: string | null;
  due_date: string | null;
};

export function QuickTaskForm({
  users,
  onCreate,
  onCancel,
  saving = false,
}: {
  users: AccountUser[];
  onCreate: (draft: QuickTaskDraft) => Promise<void> | void;
  onCancel: () => void;
  saving?: boolean;
}) {
  const [title, setTitle] = useState("");
  const [responsible, setResponsible] = useState<string | null>(null);
  const [day, setDay] = useState("");
  // Linhas fantasma até serem tocadas: é o repouso do formulário, e o que
  // mantém o cartão do tamanho de um cartão.
  const [showUser, setShowUser] = useState(false);
  const [showDate, setShowDate] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLFormElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    box.current?.scrollIntoView({ block: "nearest" });
  }, []);

  const pronto = title.trim().length > 0 && !saving;

  async function submit() {
    if (!pronto) return;
    try {
      await onCreate({
        title: title.trim(),
        responsible_user_id: responsible,
        due_date: dueFromDay(day),
      });
    } catch {
      // Quem chama já avisou na tela. Aqui o que importa é não limpar o nome:
      // a pessoa acabou de digitar e a linha não entrou.
      return;
    }
    // Só o nome volta a zero. Quem cadastra três tarefas seguidas quase sempre
    // as cadastra para a mesma pessoa e o mesmo prazo; refazer essa escolha a
    // cada linha é o que torna o atalho inútil.
    setTitle("");
    inputRef.current?.focus();
  }

  return (
    <form
      ref={box}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
        }
      }}
      className="space-y-2 rounded-xl border border-primary bg-card p-2 shadow-xs ring-2 ring-ring/25"
    >
      <div className="flex items-start gap-2">
        <input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Nome da tarefa…"
          maxLength={200}
          className="min-w-0 flex-1 bg-transparent py-1 text-sm font-medium text-foreground outline-none placeholder:text-muted-foreground"
        />
        <button
          type="submit"
          disabled={!pronto}
          className="flex shrink-0 items-center gap-1 rounded-lg bg-secondary px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 className="size-3.5 animate-spin" /> : "Salvar"}
          {!saving && <CornerDownLeft className="size-3 opacity-60" />}
        </button>
      </div>

      {showUser || responsible ? (
        <div className="flex items-center gap-1">
          <UserSelect
            users={users}
            value={responsible}
            onChange={setResponsible}
            placeholder="Sem responsável"
            autoOpen={showUser}
            triggerClassName="flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-card px-2 text-xs outline-none transition-colors hover:bg-secondary focus:ring-1 focus:ring-ring"
          />
        </div>
      ) : (
        <GhostRow icon={UserRound} onClick={() => setShowUser(true)}>
          Adicionar responsável
        </GhostRow>
      )}

      {showDate || day ? (
        <div className="flex items-center gap-1">
          <DateField
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            aria-label="Prazo"
            autoOpen={showDate}
            // `w-auto` desfaz o `w-full` que o DateField traz de fábrica: com
            // ele, o campo tomava a linha inteira e empurrava o botão de
            // remover para fora do cartão.
            className="h-9 w-auto min-w-0 flex-1 rounded-lg text-xs"
          />
          {day && (
            <button
              type="button"
              onClick={() => {
                setDay("");
                setShowDate(false);
              }}
              aria-label="Remover prazo"
              // Alvo de 44px no dedo; a densidade do desktop volta no `sm`.
              className="flex size-11 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground sm:size-7"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      ) : (
        <GhostRow icon={CalendarDays} onClick={() => setShowDate(true)}>
          Adicionar prazo
        </GhostRow>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="w-full rounded-lg px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        Fechar
      </button>
    </form>
  );
}

function GhostRow({
  icon: Icon,
  onClick,
  children,
}: {
  icon: typeof UserRound;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      // `py-2` e não `py-1`: no celular esta linha é alvo de dedo.
      className="flex w-full items-center gap-2 rounded-lg px-1 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
    >
      <Icon className="size-3.5 shrink-0" />
      {children}
    </button>
  );
}

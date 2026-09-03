import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { CalendarClock, ChevronLeft, ChevronRight, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTone } from "@/hooks/use-tone";
import { useAgendaEvents, useGoogleStatus, useSyncGoogleNow } from "@/lib/google";
import { useSaveTask, type Task } from "@/lib/tasks";
import { formatDateBR, toISODate } from "@/lib/format";
import { WEEKDAY_LABELS, monthMatrix, todayKey, weekDays } from "@/lib/tasks-analytics";
import { resumirTitulo, tituloPorExtenso } from "@/lib/task-title";
import { buildCalendarEntries, type EntryMeta } from "./calendar-entries";
import { TimeGrid, type GridEntry } from "./TimeGrid";

/**
 * Calendário do painel: tarefas do app e compromissos da agenda no mesmo lugar.
 *
 * A semana é o padrão porque é a janela em que se trabalha, e ela abre na grade
 * de horários — com o dia como régua, dá para ver o que se atropela e arrastar
 * a tarefa para outro horário. O mês continua sendo uma lista por dia: numa
 * célula de 4cm, uma régua de 24 horas não caberia legível.
 */

type Mode = "week" | "month";

/** Dia local do timestamp — o usuário pensa no fuso dele, não em UTC. */
function localDay(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

function hourLabel(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (date.getHours() === 0 && date.getMinutes() === 0) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function shiftDate(base: Date, mode: Mode, direction: number): Date {
  const next = new Date(base);
  if (mode === "week") next.setDate(next.getDate() + direction * 7);
  else next.setMonth(next.getMonth() + direction);
  return next;
}

export function AgendaCalendar({
  tasks,
  onOpenTask,
}: {
  tasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const tone = useTone();
  const { data: status } = useGoogleStatus();
  const sync = useSyncGoogleNow();
  const save = useSaveTask();

  const [mode, setMode] = useState<Mode>("week");
  const [reference, setReference] = useState(() => new Date());

  const dayList = useMemo(
    () => (mode === "week" ? weekDays(reference) : monthMatrix(reference)),
    [mode, reference],
  );
  const days = useMemo(() => dayList.map(toISODate), [dayList]);
  const range = useMemo(
    () => ({ from: days[0] ?? todayKey(), to: days[days.length - 1] ?? todayKey() }),
    [days],
  );

  const { data: agenda = [], isFetching } = useAgendaEvents(status?.connected ? range : null);

  const { entries, meta } = useMemo(() => buildCalendarEntries(tasks, agenda), [tasks, agenda]);

  const openEntry = useCallback(
    (entry: GridEntry) => {
      if (entry.source === "agenda") {
        if (entry.link) window.open(entry.link, "_blank", "noreferrer");
        return;
      }
      const found = meta.get(entry.id);
      if (found) onOpenTask(found.task);
    },
    [meta, onOpenTask],
  );

  const persist = useCallback(
    async (found: EntryMeta, start: Date, end: Date) => {
      const { task, write } = found;
      const dates =
        write === "both"
          ? { start_date: start.toISOString(), due_date: end.toISOString() }
          : write === "due"
            ? { due_date: start.toISOString() }
            : { start_date: start.toISOString() };

      try {
        await save.mutateAsync({
          id: task.id,
          board_id: task.board_id,
          status_id: task.status_id,
          title: task.title,
          ...dates,
        });
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Não foi possível mover a tarefa");
      }
    },
    [save],
  );

  const handleMove = useCallback(
    (entry: GridEntry, start: Date, end: Date) => {
      const found = meta.get(entry.id);
      if (found) void persist(found, start, end);
    },
    [meta, persist],
  );

  const handleResize = useCallback(
    (entry: GridEntry, end: Date) => {
      const found = meta.get(entry.id);
      if (found) void persist(found, entry.start, end);
    },
    [meta, persist],
  );

  /** Chips do mês: a visão mensal continua sendo lista, não régua. */
  const monthByDay = useMemo(() => {
    if (mode !== "month") return new Map<string, GridEntry[]>();
    const map = new Map<string, GridEntry[]>();
    for (const entry of entries) {
      const key = localDay(entry.start.toISOString());
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    for (const [, list] of map) list.sort((a, b) => a.start.getTime() - b.start.getTime());
    return map;
  }, [mode, entries]);

  const title =
    mode === "week" && days.length > 0
      ? `${formatDateBR(days[0]!)} — ${formatDateBR(days[days.length - 1]!)}`
      : reference.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });

  const today = todayKey();

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReference((base) => shiftDate(base, mode, -1))}
            aria-label="Período anterior"
          >
            <ChevronLeft className="size-4" />
          </Button>
          <Button size="sm" variant="outline" onClick={() => setReference(new Date())}>
            Hoje
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setReference((base) => shiftDate(base, mode, 1))}
            aria-label="Próximo período"
          >
            <ChevronRight className="size-4" />
          </Button>
          <span className="ml-2 text-sm font-medium first-letter:uppercase">{title}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {mode === "week" && (
            <p className="hidden text-[11px] text-muted-foreground lg:block">
              Arraste para mover · puxe a borda de baixo para mudar a duração
            </p>
          )}
          <div className="flex rounded-xl border border-border bg-secondary p-0.5">
            {(
              [
                ["week", "Semana"],
                ["month", "Mês"],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                onClick={() => setMode(value)}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                  mode === value
                    ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {status?.connected && (
            <Button
              size="sm"
              variant="outline"
              disabled={sync.isPending || isFetching}
              onClick={async () => {
                /*
                 * O `try` não é zelo: sem ele, uma falha ao falar com o Google
                 * (token revogado, cota, rede) rejeitava a promessa e o clique
                 * não produzia aviso nenhum — a tela ficava idêntica, como se o
                 * botão simplesmente não funcionasse.
                 */
                try {
                  const result = await sync.mutateAsync();
                  const notas = [
                    result.pushed > 0 ? `${result.pushed} tarefa(s) enviadas` : null,
                    result.updated > 0 ? `${result.updated} com as datas atualizadas` : null,
                    result.cleared > 0 ? `${result.cleared} com as datas limpas` : null,
                  ].filter(Boolean);

                  if (result.error) {
                    // O envio falhou, mas a leitura seguiu: contar as duas
                    // coisas evita concluir que nada aconteceu.
                    toast.error(`O Google recusou o envio: ${result.error}`, {
                      duration: 15000,
                      ...(notas.length > 0
                        ? { description: `A leitura seguiu: ${notas.join(" · ")}` }
                        : {}),
                    });
                    return;
                  }

                  toast.success(
                    notas.length > 0
                      ? `Agenda sincronizada · ${notas.join(" · ")}`
                      : // Sem isto, "sincronizada" tanto podia significar "conferi
                        // e não mudou nada" quanto "não consegui ler nada" — e são
                        // problemas bem diferentes de investigar.
                        `Agenda sincronizada · nada mudou desde a última leitura ` +
                          `(${result.read} compromisso(s) conferido(s))`,
                  );
                } catch (error) {
                  toast.error(
                    error instanceof Error
                      ? `Não foi possível sincronizar: ${error.message}`
                      : "Não foi possível sincronizar com o Google",
                    { duration: 15000 },
                  );
                }
              }}
            >
              <RefreshCw className={`mr-1 size-3.5 ${sync.isPending ? "animate-spin" : ""}`} />
              Sincronizar agora
            </Button>
          )}
        </div>
      </div>

      {status && !status.connected && (
        <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
          {status.configured
            ? "Conecte o Google Agenda no seu perfil para ver os compromissos aqui junto das tarefas."
            : "A integração com o Google Agenda não está configurada neste servidor."}
        </p>
      )}

      {status?.connected && status.lastError && (
        <p className="rounded-xl border border-negative/35 bg-negative-soft p-3 text-xs text-negative-soft-foreground">
          <span className="font-semibold">A última conversa com o Google falhou:</span>{" "}
          {status.lastError}
        </p>
      )}

      {mode === "week" ? (
        <TimeGrid
          days={dayList}
          entries={entries}
          onOpen={openEntry}
          onMove={handleMove}
          onResize={handleResize}
        />
      ) : (
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-7 border-b border-border bg-surface text-center">
            {WEEKDAY_LABELS.map((label) => (
              <div key={label} className="label-caps py-2.5">
                {label}
              </div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((day) => {
              const items = monthByDay.get(day) ?? [];
              const isToday = day === today;
              const otherMonth = Number(day.slice(5, 7)) - 1 !== reference.getMonth();
              return (
                <div
                  key={day}
                  className={`min-h-28 space-y-0.5 border-b border-r border-border p-1.5 last:border-r-0 ${
                    otherMonth ? "bg-surface/60" : ""
                  }`}
                >
                  <p
                    className={`mb-1 text-[11px] ${
                      isToday
                        ? "inline-flex size-6 items-center justify-center rounded-full bg-primary font-bold text-primary-foreground shadow-glow"
                        : otherMonth
                          ? "text-muted-foreground/60"
                          : "text-muted-foreground"
                    }`}
                  >
                    {Number(day.slice(8, 10))}
                  </p>

                  {items.slice(0, 4).map((entry) =>
                    entry.source === "task" ? (
                      <button
                        key={entry.id}
                        onClick={() => openEntry(entry)}
                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-colors hover:bg-accent"
                      >
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: tone(entry.color) }}
                        />
                        <span
                          className={`min-w-0 flex-1 truncate ${entry.done ? "done-text" : ""}`}
                          title={tituloPorExtenso(entry.title)}
                        >
                          {resumirTitulo(entry.title)}
                        </span>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {hourLabel(entry.allDay ? null : entry.start.toISOString())}
                        </span>
                      </button>
                    ) : (
                      <a
                        key={entry.id}
                        href={entry.link ?? "#"}
                        target={entry.link ? "_blank" : undefined}
                        rel="noreferrer"
                        className="flex w-full items-center gap-1.5 rounded-md border border-dashed border-warning/40 bg-warning-soft px-1.5 py-1 text-[11px] text-warning-soft-foreground transition-colors hover:border-warning"
                        title="Compromisso da agenda"
                      >
                        <CalendarClock className="size-2.5 shrink-0" />
                        <span
                          className="min-w-0 flex-1 truncate"
                          title={tituloPorExtenso(entry.title)}
                        >
                          {resumirTitulo(entry.title)}
                        </span>
                        {entry.link && <ExternalLink className="size-2.5 shrink-0 opacity-60" />}
                      </a>
                    ),
                  )}
                  {items.length > 4 && (
                    <p className="px-1 text-[10px] text-muted-foreground">+{items.length - 4}</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, ExternalLink, GripHorizontal } from "lucide-react";

import { useNow } from "@/hooks/use-now";
import { cn } from "@/lib/utils";

/**
 * Grade de horários — a visão de semana e de dia dos calendários.
 *
 * As duas visões mostravam o dia como uma lista: dava para saber *o que* tinha
 * no dia, nunca *quando*, nem se duas coisas se atropelavam. Aqui o dia é uma
 * régua de 24 horas, o bloco ocupa a altura do tempo que consome, e o que se
 * sobrepõe divide a largura — a leitura que se espera de uma agenda.
 *
 * O que o app é dono, o app deixa mexer: tarefa se arrasta para outro dia ou
 * horário e se estica pela borda de baixo. Compromisso da agenda do Google fica
 * visível e clicável, mas não se move daqui — editar o compromisso de alguém
 * pela metade, sem garantir a escrita do outro lado, é pior do que mandar a
 * pessoa ao Google.
 */

/** Altura de uma hora, em pixels. É o que dá "corpo" à grade. */
const HOUR = 56;
/** O arraste anda de 15 em 15 minutos, como numa agenda de verdade. */
const SNAP = 15;
const DAY_MINUTES = 24 * 60;
/** Menor bloco que ainda mostra o título. */
const MIN_MINUTES = 15;

export type GridEntry = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  /** Cor do bloco (hex do status/quadro, ou uma variável do tema). */
  color: string;
  /** Sem horário definido: vai para a faixa do topo, fora da régua. */
  allDay: boolean;
  source: "task" | "agenda";
  /** Arrastável para outro dia/horário. */
  canMove: boolean;
  /** Esticável pela borda de baixo. */
  canResize: boolean;
  subtitle?: string | undefined;
  link?: string | undefined;
  /** Concluída: o bloco recua e o título fica riscado. */
  done?: boolean | undefined;
};

type Props = {
  /** Um dia (visão diária) ou sete (semanal). */
  days: Date[];
  entries: GridEntry[];
  onOpen: (entry: GridEntry) => void;
  /** Novo início e fim depois de arrastar. */
  onMove: (entry: GridEntry, start: Date, end: Date) => void;
  /** Novo fim depois de esticar. */
  onResize: (entry: GridEntry, end: Date) => void;
};

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const minutesOf = (d: Date) => d.getHours() * 60 + d.getMinutes();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function hourLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/** Data no dia informado, no minuto informado. */
function dateAt(day: Date, minutes: number): Date {
  const out = new Date(day);
  out.setHours(0, 0, 0, 0);
  out.setMinutes(minutes);
  return out;
}

/**
 * Reparte em faixas o que acontece ao mesmo tempo.
 *
 * Sem isto, dois compromissos das 10h ficariam um sobre o outro e só o de cima
 * seria clicável. O algoritmo é o mesmo das agendas: agrupa o que se toca e
 * divide a largura do grupo pelo maior número de blocos simultâneos.
 */
function layoutLanes(list: GridEntry[]): Array<{ entry: GridEntry; lane: number; lanes: number }> {
  const sorted = [...list].sort(
    (a, b) => a.start.getTime() - b.start.getTime() || b.end.getTime() - a.end.getTime(),
  );
  const out: Array<{ entry: GridEntry; lane: number; lanes: number }> = [];

  let cluster: Array<{ entry: GridEntry; lane: number }> = [];
  let clusterEnd = 0;

  const flush = () => {
    const lanes = cluster.reduce((max, item) => Math.max(max, item.lane + 1), 1);
    for (const item of cluster) out.push({ ...item, lanes });
    cluster = [];
    clusterEnd = 0;
  };

  for (const entry of sorted) {
    if (cluster.length && entry.start.getTime() >= clusterEnd) flush();

    // Primeira faixa livre no grupo atual.
    const taken = new Set(
      cluster.filter((item) => item.entry.end.getTime() > entry.start.getTime()).map((i) => i.lane),
    );
    let lane = 0;
    while (taken.has(lane)) lane += 1;

    cluster.push({ entry, lane });
    clusterEnd = Math.max(clusterEnd, entry.end.getTime());
  }
  if (cluster.length) flush();

  return out;
}

type Drag = {
  entry: GridEntry;
  mode: "move" | "resize";
  /** Minutos entre o topo do bloco e o ponto agarrado. */
  grab: number;
  duration: number;
  dayIndex: number;
  startMin: number;
  endMin: number;
  moved: boolean;
};

export function TimeGrid({ days, entries, onOpen, onMove, onResize }: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const now = useNow(60_000);

  const timed = entries.filter((e) => !e.allDay);
  const allDay = entries.filter((e) => e.allDay);

  const byDay = useMemo(() => {
    const map = new Map<string, GridEntry[]>();
    for (const entry of timed) {
      const key = dayKey(entry.start);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [timed]);

  const allDayByDay = useMemo(() => {
    const map = new Map<string, GridEntry[]>();
    for (const entry of allDay) {
      const key = dayKey(entry.start);
      map.set(key, [...(map.get(key) ?? []), entry]);
    }
    return map;
  }, [allDay]);

  /*
   * Abre na primeira hora que tem alguma coisa (com uma hora de folga acima), ou
   * às 7h. Abrir à meia-noite obrigaria a rolar até o dia começar de fato.
   */
  useEffect(() => {
    if (!scroller.current) return;
    const earliest = timed.reduce((min, entry) => Math.min(min, minutesOf(entry.start)), 7 * 60);
    scroller.current.scrollTop = Math.max(0, ((earliest - 60) / 60) * HOUR);
    // Só ao trocar de janela: rolar a cada mudança de tarefa seria um susto.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days[0]?.getTime(), days.length]);

  /** Posição do ponteiro -> dia e minuto da grade. */
  function pointerToSlot(event: PointerEvent | React.PointerEvent) {
    const rect = surface.current?.getBoundingClientRect();
    if (!rect) return null;
    const column = rect.width / days.length;
    const dayIndex = clamp(Math.floor((event.clientX - rect.left) / column), 0, days.length - 1);
    const raw = ((event.clientY - rect.top) / HOUR) * 60;
    return { dayIndex, minutes: clamp(raw, 0, DAY_MINUTES) };
  }

  function startDrag(
    event: React.PointerEvent,
    entry: GridEntry,
    mode: "move" | "resize",
    dayIndex: number,
  ) {
    if (mode === "move" && !entry.canMove) return;
    if (mode === "resize" && !entry.canResize) return;
    event.preventDefault();
    event.stopPropagation();

    const startMin = minutesOf(entry.start);
    const endMin = Math.max(startMin + MIN_MINUTES, minutesOf(entry.end));
    const slot = pointerToSlot(event);

    setDrag({
      entry,
      mode,
      grab: slot ? slot.minutes - startMin : 0,
      duration: endMin - startMin,
      dayIndex,
      startMin,
      endMin,
      moved: false,
    });
  }

  // Enquanto arrasta, o ponteiro é ouvido na janela: soltar fora do bloco (ou
  // fora da grade) precisa terminar o gesto do mesmo jeito.
  useEffect(() => {
    if (!drag) return;

    const move = (event: PointerEvent) => {
      const slot = pointerToSlot(event);
      if (!slot) return;
      setDrag((current) => {
        if (!current) return current;
        const snap = (m: number) => Math.round(m / SNAP) * SNAP;

        if (current.mode === "resize") {
          const end = clamp(snap(slot.minutes), current.startMin + MIN_MINUTES, DAY_MINUTES);
          if (end === current.endMin && current.moved) return current;
          return { ...current, endMin: end, moved: true };
        }

        const start = clamp(snap(slot.minutes - current.grab), 0, DAY_MINUTES - current.duration);
        if (current.moved && start === current.startMin && slot.dayIndex === current.dayIndex) {
          return current;
        }
        return {
          ...current,
          dayIndex: slot.dayIndex,
          startMin: start,
          endMin: start + current.duration,
          moved: true,
        };
      });
    };

    const up = () => {
      setDrag((current) => {
        if (!current) return null;
        // Um clique é um arraste que não andou: abre em vez de mover.
        if (!current.moved) {
          onOpen(current.entry);
          return null;
        }
        const day = days[current.dayIndex] ?? current.entry.start;
        if (current.mode === "resize") {
          onResize(current.entry, dateAt(current.entry.start, current.endMin));
        } else {
          onMove(current.entry, dateAt(day, current.startMin), dateAt(day, current.endMin));
        }
        return null;
      });
    };

    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag?.entry.id, drag?.mode, days]);

  const today = dayKey(new Date());
  const nowMinutes = minutesOf(new Date(now));
  const columns = `4rem repeat(${days.length}, minmax(0, 1fr))`;

  return (
    <div className={cn("panel overflow-hidden", drag && "select-none")}>
      {/* Cabeçalho dos dias — fica fora do rolo, sempre à vista. */}
      <div
        className="grid border-b border-border bg-surface"
        style={{ gridTemplateColumns: columns }}
      >
        <div />
        {days.map((day) => {
          const isToday = dayKey(day) === today;
          return (
            <div key={day.toISOString()} className="border-l border-border px-2 py-2.5 text-center">
              <p className="label-caps text-[0.6rem]">
                {day.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", "")}
              </p>
              <p
                className={cn(
                  "mx-auto mt-1 flex size-7 items-center justify-center rounded-full text-sm font-bold",
                  isToday ? "bg-primary text-primary-foreground shadow-glow" : "",
                )}
              >
                {day.getDate()}
              </p>
            </div>
          );
        })}
      </div>

      {/* Faixa do que não tem horário: fica fora da régua, como no Google. */}
      {allDay.length > 0 && (
        <div
          className="grid border-b border-border bg-surface/60"
          style={{ gridTemplateColumns: columns }}
        >
          <div className="label-caps flex items-center justify-end px-2 py-2 text-[0.55rem]">
            Sem hora
          </div>
          {days.map((day) => (
            <div key={day.toISOString()} className="space-y-1 border-l border-border p-1">
              {(allDayByDay.get(dayKey(day)) ?? []).map((entry) => (
                <Chip key={entry.id} entry={entry} onOpen={onOpen} />
              ))}
            </div>
          ))}
        </div>
      )}

      <div ref={scroller} className="thin-scrollbar max-h-[68vh] overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: columns }}>
          {/* Régua das horas. */}
          <div className="relative" style={{ height: 24 * HOUR }}>
            {Array.from({ length: 24 }, (_, hour) => (
              <span
                key={hour}
                className="absolute right-2 -translate-y-1/2 font-mono text-[10px] text-muted-foreground"
                style={{ top: hour * HOUR }}
              >
                {hour === 0 ? "" : hourLabel(hour * 60)}
              </span>
            ))}
          </div>

          <div
            ref={surface}
            className="relative col-span-full col-start-2"
            style={{ height: 24 * HOUR }}
          >
            {/* Linhas de hora, atravessando todas as colunas. */}
            {Array.from({ length: 24 }, (_, hour) => (
              <div
                key={hour}
                className="pointer-events-none absolute inset-x-0 border-t border-border"
                style={{ top: hour * HOUR }}
              />
            ))}

            <div className="absolute inset-0 flex">
              {days.map((day, dayIndex) => {
                const key = dayKey(day);
                const isToday = key === today;
                const laid = layoutLanes(byDay.get(key) ?? []);

                return (
                  <div key={key} className="relative flex-1 border-l border-border">
                    {isToday && (
                      /* Onde estamos agora: a linha que a agenda do Google tem. */
                      <div
                        className="pointer-events-none absolute inset-x-0 z-20 flex items-center"
                        style={{ top: (nowMinutes / 60) * HOUR }}
                      >
                        <span className="-ml-1 size-2 shrink-0 rounded-full bg-negative" />
                        <span className="h-px flex-1 bg-negative" />
                      </div>
                    )}

                    {laid.map(({ entry, lane, lanes }) => {
                      const dragging = drag?.entry.id === entry.id;
                      // Enquanto arrasta, o bloco só existe na coluna de destino.
                      if (dragging && drag && drag.dayIndex !== dayIndex) return null;

                      const startMin = dragging && drag ? drag.startMin : minutesOf(entry.start);
                      const endMin = dragging && drag ? drag.endMin : minutesOf(entry.end);
                      const height = Math.max(
                        (MIN_MINUTES / 60) * HOUR,
                        ((endMin - startMin) / 60) * HOUR,
                      );

                      return (
                        <EventBlock
                          key={entry.id}
                          entry={entry}
                          dragging={dragging}
                          top={(startMin / 60) * HOUR}
                          height={height}
                          left={dragging ? 0 : (lane / lanes) * 100}
                          width={dragging ? 100 : (1 / lanes) * 100}
                          label={`${hourLabel(startMin)} – ${hourLabel(endMin)}`}
                          onPointerDown={(event, mode) => startDrag(event, entry, mode, dayIndex)}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Item da faixa "sem hora": não tem duração para desenhar, então é um chip. */
function Chip({ entry, onOpen }: { entry: GridEntry; onOpen: (entry: GridEntry) => void }) {
  const agenda = entry.source === "agenda";
  return (
    <button
      onClick={() => onOpen(entry)}
      title={entry.title}
      className={cn(
        "flex w-full items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-left text-[11px] font-medium transition-colors",
        agenda
          ? "border border-dashed border-warning/40 bg-warning-soft text-warning-soft-foreground"
          : "hover:bg-accent",
      )}
    >
      {agenda ? (
        <CalendarClock className="size-2.5 shrink-0" />
      ) : (
        <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: entry.color }} />
      )}
      <span className={cn("truncate", entry.done && "done-text")}>{entry.title}</span>
    </button>
  );
}

function EventBlock({
  entry,
  dragging,
  top,
  height,
  left,
  width,
  label,
  onPointerDown,
}: {
  entry: GridEntry;
  dragging: boolean;
  top: number;
  height: number;
  left: number;
  width: number;
  label: string;
  onPointerDown: (event: React.PointerEvent, mode: "move" | "resize") => void;
}) {
  const agenda = entry.source === "agenda";
  const compact = height < 44;

  return (
    <div
      role="button"
      tabIndex={0}
      onPointerDown={(event) => onPointerDown(event, "move")}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onPointerDown(event as unknown as React.PointerEvent, "move");
        }
      }}
      title={`${entry.title} · ${label}${entry.subtitle ? ` · ${entry.subtitle}` : ""}`}
      className={cn(
        "group absolute overflow-hidden rounded-lg border px-2 py-1 text-left",
        entry.canMove ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        dragging ? "z-30 glow-strong" : "z-10 hover-glow",
        agenda && "border-dashed",
      )}
      style={{
        top,
        height,
        left: `calc(${left}% + 2px)`,
        width: `calc(${width}% - 4px)`,
        // A cor do item pinta a borda, um véu de fundo e o halo: cor cheia num
        // bloco grande apagaria o texto e brigaria com os blocos vizinhos.
        ["--glow" as string]: entry.color,
        borderColor: `color-mix(in oklab, ${entry.color} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${entry.color} 16%, var(--color-card))`,
        opacity: entry.done ? 0.65 : 1,
      }}
    >
      <span
        className="absolute inset-y-0 left-0 w-1"
        style={{ backgroundColor: entry.color }}
        aria-hidden
      />
      <p
        className={cn(
          "ml-1.5 truncate text-[11px] font-semibold leading-tight",
          entry.done && "done-text",
        )}
      >
        {agenda && <CalendarClock className="mr-1 inline size-2.5 -translate-y-px" />}
        {entry.title}
        {agenda && entry.link && (
          <ExternalLink className="ml-1 inline size-2.5 -translate-y-px opacity-0 transition-opacity group-hover:opacity-70" />
        )}
      </p>
      {!compact && (
        <p className="ml-1.5 truncate font-mono text-[10px] text-muted-foreground">{label}</p>
      )}

      {entry.canResize && (
        /* Pega de baixo: é por ela que o bloco estica, sem mover o começo. */
        <span
          onPointerDown={(event) => onPointerDown(event, "resize")}
          className="absolute inset-x-0 bottom-0 flex h-2 cursor-ns-resize items-end justify-center opacity-0 transition-opacity group-hover:opacity-100"
          aria-hidden
        >
          <GripHorizontal className="size-3 text-muted-foreground" />
        </span>
      )}
    </div>
  );
}

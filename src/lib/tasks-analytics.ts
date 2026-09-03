import { parseISODate, toISODate } from "./format";

export type Polarity = "IN_PROGRESS" | "SUCCESS" | "ARCHIVED";
export type BoardView = "kanban" | "list" | "calendar";
export type BoardStage = "planning" | "active" | "paused" | "done";

export const POLARITIES: Array<{ value: Polarity; label: string; hint: string; color: string }> = [
  {
    value: "IN_PROGRESS",
    label: "Em andamento",
    hint: "Tarefa ainda ativa no fluxo de trabalho",
    color: "#3B82F6",
  },
  {
    value: "SUCCESS",
    label: "Sucesso",
    hint: "Tarefa finalizada com sucesso",
    color: "#10B981",
  },
  {
    value: "ARCHIVED",
    label: "Arquivado",
    hint: "Fora do fluxo ativo (arquivada, cancelada, descartada)",
    color: "#94A3B8",
  },
];

export const polarityLabel = (p: Polarity) =>
  POLARITIES.find((x) => x.value === p)?.label ?? "Em andamento";

export const BOARD_STAGES: Array<{ value: BoardStage; label: string }> = [
  { value: "planning", label: "Planejamento" },
  { value: "active", label: "Em andamento" },
  { value: "paused", label: "Pausado" },
  { value: "done", label: "Concluído" },
];

export const BOARD_VIEWS: Array<{ value: BoardView; label: string }> = [
  { value: "kanban", label: "Kanban" },
  { value: "list", label: "Lista" },
  { value: "calendar", label: "Calendário" },
];

export type Priority = "urgent" | "high" | "normal" | "low" | "none";

/**
 * Prioridade da tarefa.
 *
 * Urgência precisa saltar aos olhos num quadro cheio, e o nome por extenso mais
 * a cor são o que dá essa leitura imediata. `color` é o hex usado nos gráficos;
 * `chip` e `dot` trazem a mesma cor em classes do design system, que já se
 * viram sozinhas nos dois temas.
 */
export const PRIORITIES: Array<{
  value: Priority;
  label: string;
  chip: string;
  dot: string;
  color: string;
  weight: number;
}> = [
  {
    value: "urgent",
    label: "Urgente",
    chip: "border-negative/35 bg-negative-soft text-negative-soft-foreground",
    dot: "bg-negative",
    color: "#EF4444",
    weight: 4,
  },
  {
    value: "high",
    label: "Alta",
    chip: "border-warning/40 bg-warning-soft text-warning-soft-foreground",
    dot: "bg-warning",
    color: "#F59E0B",
    weight: 3,
  },
  {
    value: "normal",
    label: "Normal",
    chip: "border-info/35 bg-info-soft text-info-soft-foreground",
    dot: "bg-info",
    color: "#3B82F6",
    weight: 2,
  },
  {
    value: "low",
    label: "Baixa",
    chip: "border-border bg-secondary text-muted-foreground",
    dot: "bg-muted-foreground",
    color: "#64748B",
    weight: 1,
  },
  {
    value: "none",
    label: "Sem prioridade",
    chip: "border-dashed border-border text-muted-foreground",
    dot: "bg-transparent ring-1 ring-border",
    color: "#D4D4D4",
    weight: 0,
  },
];

export const priorityOf = (value: Priority | null | undefined) =>
  PRIORITIES.find((p) => p.value === value) ?? PRIORITIES[2]!;

export type StatusSeed = { name: string; color: string; polarity: Polarity };

/** Conjuntos de status oferecidos na criação do quadro. */
export const STATUS_PRESETS: Array<{ id: string; label: string; statuses: StatusSeed[] }> = [
  {
    id: "default",
    label: "Padrão",
    statuses: [
      { name: "Em andamento", color: "#3B82F6", polarity: "IN_PROGRESS" },
      { name: "Concluído", color: "#10B981", polarity: "SUCCESS" },
      { name: "Arquivado", color: "#94A3B8", polarity: "ARCHIVED" },
    ],
  },
  {
    id: "dev",
    label: "Desenvolvimento",
    statuses: [
      { name: "Backlog", color: "#94A3B8", polarity: "IN_PROGRESS" },
      { name: "A fazer", color: "#6366F1", polarity: "IN_PROGRESS" },
      { name: "Em desenvolvimento", color: "#3B82F6", polarity: "IN_PROGRESS" },
      { name: "Em revisão", color: "#06B6D4", polarity: "IN_PROGRESS" },
      { name: "Concluído", color: "#10B981", polarity: "SUCCESS" },
      { name: "Cancelado", color: "#94A3B8", polarity: "ARCHIVED" },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    statuses: [
      { name: "Pendente", color: "#94A3B8", polarity: "IN_PROGRESS" },
      { name: "Em contato", color: "#6366F1", polarity: "IN_PROGRESS" },
      { name: "Aguardando cliente", color: "#F59E0B", polarity: "IN_PROGRESS" },
      { name: "Resolvido", color: "#10B981", polarity: "SUCCESS" },
      { name: "Arquivado", color: "#94A3B8", polarity: "ARCHIVED" },
    ],
  },
];

/**
 * Paleta do sistema: dez matizes vivos, espaçados no círculo cromático e todos
 * no mesmo nível de saturação. É o que dá a espaços, quadros, status, etiquetas
 * e avatares uma identidade própria — dois itens vizinhos nunca caem no mesmo
 * tom, e nenhum deles briga com o violeta da marca.
 */
export const PALETTE = [
  "#6366F1",
  "#8B5CF6",
  "#EC4899",
  "#EF4444",
  "#F97316",
  "#F59E0B",
  "#84CC16",
  "#10B981",
  "#06B6D4",
  "#3B82F6",
];

/** Tons das etiquetas — a mesma paleta, que já se distingue no meio do texto. */
export const LABEL_PALETTE = PALETTE;

// ---------------------------------------------------------------------------
// Tempo
// ---------------------------------------------------------------------------

/** 4530 -> "01:15:30" */
export const formatClock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
};

/** 4530 -> "1h 15min" */
export const formatDuration = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h === 0 && m === 0) return `${s}s`;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, "0")}min`;
};

export const hoursOf = (seconds: number) => Math.round((seconds / 3600) * 100) / 100;

/** 2.5 -> "2h30" · 3 -> "3h" */
export const formatHours = (hours: number) => {
  const total = Math.max(0, Math.round(hours * 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}min`;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
};

export type EstimateState = "none" | "under" | "near" | "over";

/**
 * Compara o tempo já registrado com a estimativa da tarefa.
 * `near` começa em 80% do estimado — é o aviso antes de estourar.
 */
export function estimateState(estimateHours: number | null, trackedSeconds: number): EstimateState {
  if (!estimateHours || estimateHours <= 0) return "none";
  const ratio = hoursOf(trackedSeconds) / estimateHours;
  if (ratio > 1) return "over";
  if (ratio >= 0.8) return "near";
  return "under";
}

export const estimateClass = (state: EstimateState) =>
  state === "over"
    ? "text-negative font-semibold"
    : state === "near"
      ? "text-foreground font-medium"
      : "text-muted-foreground";

// ---------------------------------------------------------------------------
// Datas / prazos
// ---------------------------------------------------------------------------

/** Converte um timestamptz do banco no valor de um <input type="datetime-local">. */
export const toLocalInput = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  const tz = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return tz.toISOString().slice(0, 16);
};

export const fromLocalInput = (value: string) => (value ? new Date(value).toISOString() : null);

/**
 * Um dia escolhido (YYYY-MM-DD) vira prazo no fim desse dia, no fuso de quem
 * escolheu.
 *
 * Montado campo a campo de propósito: `new Date("2026-09-10")` é lido como
 * meia-noite em UTC, que em São Paulo é 21h do dia 9 — a tarefa nasceria
 * vencendo um dia antes do que a pessoa marcou. E o fim do dia, e não o
 * começo, porque "para o dia 10" quer dizer até o fim do dia 10.
 */
export const dueFromDay = (day: string): string | null => {
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  return new Date(year, month - 1, date, 23, 59).toISOString();
};

/** Dia local (YYYY-MM-DD) de um timestamptz. */
export const dayKey = (iso: string | null) => (iso ? toISODate(new Date(iso)) : null);

export const todayKey = () => toISODate(new Date());

export const formatDateTimeBR = (iso: string | null, withTime = true) => {
  if (!iso) return "—";
  const d = new Date(iso);
  const date = d.toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
  if (!withTime) return date;
  const hasTime = d.getHours() !== 0 || d.getMinutes() !== 0;
  return hasTime
    ? `${date} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`
    : date;
};

export type DeadlineState = "none" | "on_track" | "due_today" | "late" | "done" | "archived";

export const DEADLINE_LABEL: Record<DeadlineState, string> = {
  none: "Sem prazo",
  on_track: "Dentro do prazo",
  due_today: "Vence hoje",
  late: "Atrasada",
  done: "Concluída",
  archived: "Arquivada",
};

export function deadlineState(input: {
  due_date: string | null;
  polarity: Polarity | null;
}): DeadlineState {
  if (input.polarity === "SUCCESS") return "done";
  if (input.polarity === "ARCHIVED") return "archived";
  if (!input.due_date) return "none";
  const due = dayKey(input.due_date)!;
  const today = todayKey();
  if (due < today) return "late";
  if (due === today) return "due_today";
  return "on_track";
}

export const deadlineClass = (state: DeadlineState) =>
  state === "late"
    ? "text-negative font-semibold"
    : state === "due_today"
      ? "text-foreground font-semibold"
      : state === "done"
        ? "text-positive"
        : "text-muted-foreground";

/** Lista de dias (YYYY-MM-DD) cobertos por um intervalo, limitada a `max` dias. */
export function daysOfRange(startISO: string | null, endISO: string | null, max = 60) {
  const first = dayKey(startISO) ?? dayKey(endISO);
  const last = dayKey(endISO) ?? dayKey(startISO);
  if (!first || !last) return [] as string[];
  /*
   * Nada impede que uma tarefa acabe com o início depois do prazo — basta
   * alguém corrigir uma das duas datas e esquecer a outra. Sem esta troca, o
   * laço abaixo não roda nenhuma vez e a tarefa simplesmente some do
   * calendário, que é o pior jeito de avisar que as datas estão trocadas.
   */
  const [start, end] = first <= last ? [first, last] : [last, first];
  const out: string[] = [];
  const cursor = parseISODate(start);
  const limit = parseISODate(end);
  while (cursor <= limit && out.length < max) {
    out.push(toISODate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

export function monthMatrix(anchor: Date) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = new Date(first);
  start.setDate(1 - first.getDay());
  return Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export function weekDays(anchor: Date) {
  const start = new Date(anchor);
  start.setDate(anchor.getDate() - anchor.getDay());
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return d;
  });
}

export const WEEKDAY_LABELS = ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"];

export const initialsOf = (name: string) =>
  name
    .split(/[\s.@_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("") || "?";

/** Cor estável por usuário, para os avatares. */
export const avatarColor = (seed: string) => {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  return PALETTE[hash % PALETTE.length]!;
};

/**
 * Clareia um tom para o tema escuro, mantendo o matiz.
 *
 * As cores de espaços, quadros, status e etiquetas ficam gravadas no banco como
 * hexadecimal fixo, escolhidas contra um fundo claro. No escuro, um tom fechado
 * — e os cinzas escuros que as contas antigas guardaram — desapareceria contra
 * o fundo. Então mexemos só na luminosidade: o matiz e a saturação seguem
 * intactos, e um espaço "azul" continua azul nos dois temas, apenas mais claro
 * onde precisa ser. Tom já claro demais desce um pouco, pelo mesmo motivo ao
 * contrário.
 */
export function toneForDark(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;
  const delta = max - min;

  // Cinza puro não tem matiz para preservar: espelha, como antes.
  if (delta < 0.02) {
    const mirrored = Math.round((1 - lightness * 0.82) * 255);
    const channel = mirrored.toString(16).padStart(2, "0");
    return `#${(channel + channel + channel).toUpperCase()}`;
  }

  const target = lightness < 0.62 ? 0.68 : lightness > 0.85 ? 0.78 : lightness;
  if (target === lightness) return hex.toUpperCase();

  // HSL de volta para RGB, com a mesma saturação e o mesmo matiz.
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  const hue =
    max === r
      ? ((g - b) / delta + (g < b ? 6 : 0)) * 60
      : max === g
        ? ((b - r) / delta + 2) * 60
        : ((r - g) / delta + 4) * 60;

  const c = (1 - Math.abs(2 * target - 1)) * Math.min(saturation, 0.92);
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = target - c / 2;
  const [rr, gg, bb] =
    hue < 60
      ? [c, x, 0]
      : hue < 120
        ? [x, c, 0]
        : hue < 180
          ? [0, c, x]
          : hue < 240
            ? [0, x, c]
            : hue < 300
              ? [x, 0, c]
              : [c, 0, x];

  return `#${[rr, gg, bb]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v + m)) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")
    .toUpperCase()}`;
}

/**
 * Preto ou branco sobre um fundo hexadecimal, o que tiver mais contraste.
 * Com a paleta em escala de cinza, um tom claro precisa de texto escuro —
 * senão as iniciais do avatar somem.
 */
export function contrastText(hex: string): "#FFFFFF" | "#111111" {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#FFFFFF";
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(value.slice(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
  // Luminância relativa (WCAG), simplificada com a aproximação sRGB.
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.42 ? "#111111" : "#FFFFFF";
}

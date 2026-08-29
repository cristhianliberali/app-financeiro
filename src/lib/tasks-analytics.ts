import { parseISODate, toISODate } from "./format";

export type Polarity = "IN_PROGRESS" | "SUCCESS" | "ARCHIVED";
export type BoardView = "kanban" | "list" | "calendar";
export type BoardStage = "planning" | "active" | "paused" | "done";

export const POLARITIES: Array<{ value: Polarity; label: string; hint: string; color: string }> = [
  {
    value: "IN_PROGRESS",
    label: "Em andamento",
    hint: "Tarefa ainda ativa no fluxo de trabalho",
    color: "#737373",
  },
  {
    value: "SUCCESS",
    label: "Sucesso",
    hint: "Tarefa finalizada com sucesso",
    color: "#171717",
  },
  {
    value: "ARCHIVED",
    label: "Arquivado",
    hint: "Fora do fluxo ativo (arquivada, cancelada, descartada)",
    color: "#BDBDBD",
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
 * O sistema é preto e branco, então a urgência não é sinalizada por matiz e sim
 * por contraste: `chip`/`dot` usam tokens do tema (foreground, muted…), que já
 * invertem sozinhos entre claro e escuro. `color` só existe para os gráficos,
 * onde o valor precisa ser um hex literal.
 */
export const PRIORITIES: Array<{
  value: Priority;
  label: string;
  short: string;
  chip: string;
  dot: string;
  color: string;
  weight: number;
}> = [
  {
    value: "urgent",
    label: "Urgente",
    short: "P1",
    chip: "border-foreground bg-foreground text-background",
    dot: "bg-foreground",
    color: "#171717",
    weight: 4,
  },
  {
    value: "high",
    label: "Alta",
    short: "P2",
    chip: "border-foreground/50 bg-foreground/12 text-foreground",
    dot: "bg-foreground/75",
    color: "#525252",
    weight: 3,
  },
  {
    value: "normal",
    label: "Normal",
    short: "P3",
    chip: "border-border bg-secondary text-foreground",
    dot: "bg-muted-foreground",
    color: "#8A8A8A",
    weight: 2,
  },
  {
    value: "low",
    label: "Baixa",
    short: "P4",
    chip: "border-border text-muted-foreground",
    dot: "bg-muted-foreground/45",
    color: "#BDBDBD",
    weight: 1,
  },
  {
    value: "none",
    label: "Sem prioridade",
    short: "—",
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
      { name: "Em andamento", color: "#525252", polarity: "IN_PROGRESS" },
      { name: "Concluído", color: "#171717", polarity: "SUCCESS" },
      { name: "Arquivado", color: "#BDBDBD", polarity: "ARCHIVED" },
    ],
  },
  {
    id: "dev",
    label: "Desenvolvimento",
    statuses: [
      { name: "Backlog", color: "#BDBDBD", polarity: "IN_PROGRESS" },
      { name: "A fazer", color: "#A3A3A3", polarity: "IN_PROGRESS" },
      { name: "Em desenvolvimento", color: "#737373", polarity: "IN_PROGRESS" },
      { name: "Em revisão", color: "#525252", polarity: "IN_PROGRESS" },
      { name: "Concluído", color: "#171717", polarity: "SUCCESS" },
      { name: "Cancelado", color: "#D4D4D4", polarity: "ARCHIVED" },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    statuses: [
      { name: "Pendente", color: "#BDBDBD", polarity: "IN_PROGRESS" },
      { name: "Em contato", color: "#737373", polarity: "IN_PROGRESS" },
      { name: "Aguardando cliente", color: "#525252", polarity: "IN_PROGRESS" },
      { name: "Resolvido", color: "#171717", polarity: "SUCCESS" },
      { name: "Arquivado", color: "#BDBDBD", polarity: "ARCHIVED" },
    ],
  },
];

export const SPACE_ICONS = ["📁", "📣", "💼", "💻", "💰", "🎯", "🧩", "🏢", "🛠️", "🎨", "📊", "🤝"];

/**
 * Paleta do sistema: uma escala de cinzas, do quase-preto ao quase-branco.
 * É o que dá aos espaços, quadros, status e avatares uma identidade própria
 * sem quebrar o tema preto e branco.
 */
export const PALETTE = [
  "#171717",
  "#404040",
  "#525252",
  "#737373",
  "#8A8A8A",
  "#A3A3A3",
  "#BDBDBD",
  "#D4D4D4",
];

/** Tons usados nas etiquetas — a mesma escala, começando um pouco mais clara. */
export const LABEL_PALETTE = [
  "#171717",
  "#404040",
  "#525252",
  "#737373",
  "#8A8A8A",
  "#A3A3A3",
  "#BDBDBD",
];

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
  const start = dayKey(startISO) ?? dayKey(endISO);
  const end = dayKey(endISO) ?? dayKey(startISO);
  if (!start || !end) return [] as string[];
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
 * Espelha um tom da paleta na escala de cinza (#171717 ↔ #E8E8E8).
 *
 * As cores de espaços, quadros, status e etiquetas ficam gravadas no banco como
 * hexadecimal fixo. No tema escuro um tom escuro desapareceria contra o fundo,
 * então invertemos: como a paleta é cinza, inverter cada canal devolve
 * exatamente o tom oposto, preservando a distinção entre um item e outro.
 */
export function invertTone(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return hex;
  const flipped = [0, 2, 4]
    .map((i) => (255 - parseInt(value.slice(i, i + 2), 16)).toString(16).padStart(2, "0"))
    .join("");
  return `#${flipped.toUpperCase()}`;
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

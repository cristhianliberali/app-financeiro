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
      { name: "A fazer", color: "#64748B", polarity: "IN_PROGRESS" },
      { name: "Em desenvolvimento", color: "#3B82F6", polarity: "IN_PROGRESS" },
      { name: "Em revisão", color: "#A855F7", polarity: "IN_PROGRESS" },
      { name: "Concluído", color: "#10B981", polarity: "SUCCESS" },
      { name: "Cancelado", color: "#F43F5E", polarity: "ARCHIVED" },
    ],
  },
  {
    id: "comercial",
    label: "Comercial",
    statuses: [
      { name: "Pendente", color: "#64748B", polarity: "IN_PROGRESS" },
      { name: "Em contato", color: "#3B82F6", polarity: "IN_PROGRESS" },
      { name: "Aguardando cliente", color: "#F59E0B", polarity: "IN_PROGRESS" },
      { name: "Resolvido", color: "#10B981", polarity: "SUCCESS" },
      { name: "Arquivado", color: "#94A3B8", polarity: "ARCHIVED" },
    ],
  },
];

export const SPACE_ICONS = ["📁", "📣", "💼", "💻", "💰", "🎯", "🧩", "🏢", "🛠️", "🎨", "📊", "🤝"];

export const PALETTE = [
  "#3B82F6",
  "#10B981",
  "#F59E0B",
  "#EF4444",
  "#A855F7",
  "#EC4899",
  "#14B8A6",
  "#64748B",
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
    ? "text-negative"
    : state === "due_today"
      ? "text-[#F59E0B]"
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

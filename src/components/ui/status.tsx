import * as React from "react";
import { AlertTriangle, CheckCircle2, CircleDashed, Clock3, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Marcadores de estado compartilhados por Finanças e Projetos.
 *
 * Uma transação paga, uma tarefa concluída e uma meta atingida são a mesma
 * coisa para quem olha a tela: algo que já aconteceu. Um vencimento amanhã e um
 * prazo amanhã também. Manter os cinco tons num só lugar garante que verde
 * signifique "feito" nos dois módulos, e que ninguém invente um sexto tom.
 *
 * Cada tom traz o ícone, o par de cores do selo e a cor da barra lateral
 * (`state-bar`, no `styles.css`) que marca a linha ou o cartão inteiro.
 */

export type StatusTone = "done" | "pending" | "due" | "late" | "neutral";

export const STATUS_TONES: Record<
  StatusTone,
  { icon: LucideIcon; chip: string; dot: string; text: string; bar: string }
> = {
  done: {
    icon: CheckCircle2,
    chip: "border-positive/30 bg-positive-soft text-positive-soft-foreground",
    dot: "bg-positive",
    text: "text-positive-soft-foreground",
    bar: "state-bar state-done",
  },
  pending: {
    icon: Clock3,
    chip: "border-info/30 bg-info-soft text-info-soft-foreground",
    dot: "bg-info",
    text: "text-info-soft-foreground",
    bar: "state-bar state-pending",
  },
  due: {
    icon: Clock3,
    chip: "border-warning/35 bg-warning-soft text-warning-soft-foreground",
    dot: "bg-warning",
    text: "text-warning-soft-foreground",
    bar: "state-bar state-due",
  },
  late: {
    icon: AlertTriangle,
    chip: "border-negative/30 bg-negative-soft text-negative-soft-foreground",
    dot: "bg-negative",
    text: "text-negative-soft-foreground",
    bar: "state-bar state-late",
  },
  neutral: {
    icon: CircleDashed,
    chip: "border-border bg-secondary text-muted-foreground",
    dot: "bg-muted-foreground/50",
    text: "text-muted-foreground",
    bar: "state-bar",
  },
};

/** Selo com ícone e rótulo — a forma longa do estado, para tabelas e cartões. */
export function StatusPill({
  tone,
  children,
  icon,
  className,
}: {
  tone: StatusTone;
  children: React.ReactNode;
  /** Substitui o ícone padrão do tom. */
  icon?: LucideIcon | undefined;
  className?: string | undefined;
}) {
  const preset = STATUS_TONES[tone];
  const Icon = icon ?? preset.icon;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold",
        preset.chip,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" strokeWidth={2.5} />
      {children}
    </span>
  );
}

/**
 * Ponto de estado — a forma curta, para listas densas onde não cabe rótulo.
 * O que exige ação agora (atrasado) pulsa; o resto fica quieto.
 */
export function StatusDot({
  tone,
  className,
  title,
}: {
  tone: StatusTone;
  className?: string | undefined;
  title?: string | undefined;
}) {
  const preset = STATUS_TONES[tone];
  return (
    <span
      title={title}
      aria-hidden
      className={cn(
        "inline-block size-2 shrink-0 rounded-full",
        preset.dot,
        tone === "late" && "pulse-alert",
        className,
      )}
    />
  );
}

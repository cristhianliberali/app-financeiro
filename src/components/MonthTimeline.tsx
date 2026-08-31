import { useEffect, useMemo, useRef } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { useAppState } from "@/lib/app-state";
import { useRecurring, useTransactions } from "@/lib/data";
import { MONTH_METRICS, monthTimeline, type MonthMetric } from "@/lib/analytics";
import {
  brl,
  monthChipLabel,
  monthKeyOf,
  monthRange,
  shiftMonthKey,
  toISODate,
} from "@/lib/format";

/** Quantos meses a faixa cobre para cada lado do mês em foco. */
const BACK = 5;
const FORWARD = 6;

/**
 * Linha do tempo de meses do painel.
 *
 * O painel mostrava um mês por vez e nada do que vinha antes ou depois: para
 * comparar agosto com julho era preciso trocar o período, olhar, e voltar. Aqui
 * os meses vizinhos ficam à vista com o total de cada um, o mês em foco é o
 * cartão destacado, e clicar em qualquer outro leva o painel inteiro para lá.
 *
 * A linha que costura os cartões é cheia até o mês corrente e tracejada depois:
 * o que já passou é fato, o que vem é previsão.
 */
export function MonthTimeline({
  metric,
  onMetricChange,
}: {
  metric: MonthMetric;
  onMetricChange: (metric: MonthMetric) => void;
}) {
  const { profileId, from, to, dateBasis, setRange } = useAppState();
  const strip = useRef<HTMLDivElement>(null);

  const focus = monthKeyOf(from);
  const thisMonth = monthKeyOf(toISODate(new Date()));
  const currentYear = new Date().getFullYear();

  const months = useMemo(
    () => Array.from({ length: BACK + FORWARD + 1 }, (_, i) => shiftMonthKey(focus, i - BACK)),
    [focus],
  );

  // Uma consulta cobrindo a faixa inteira; o cálculo reparte por mês.
  const span = useMemo(
    () => ({
      from: monthRange(months[0]!).from,
      to: monthRange(months[months.length - 1]!).to,
    }),
    [months],
  );

  const { data: txs = [] } = useTransactions({
    profileId,
    from: span.from,
    to: span.to,
    basis: dateBasis,
  });
  const { data: rules = [] } = useRecurring(profileId);

  const points = useMemo(
    () => monthTimeline(months, txs, rules, dateBasis, metric),
    [months, txs, rules, dateBasis, metric],
  );

  /** O mês em foco é o do período atual — desde que o período seja mensal. */
  const selected = monthKeyOf(from) === monthKeyOf(to) ? monthKeyOf(from) : null;

  // O mês em foco entra na tela sozinho: trocar o período pela barra de cima ou
  // pelas setas de mês não deveria exigir rolar a faixa atrás dele.
  useEffect(() => {
    const card = strip.current?.querySelector<HTMLElement>('[data-focus="true"]');
    card?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [focus]);

  function scrollBy(direction: number) {
    strip.current?.scrollBy({ left: direction * 320, behavior: "smooth" });
  }

  const active = MONTH_METRICS.find((m) => m.value === metric) ?? MONTH_METRICS[0]!;

  return (
    <div className="panel p-4">
      <div className="mb-1 flex flex-wrap gap-0.5 rounded-xl border border-border bg-secondary p-1">
        {MONTH_METRICS.map((option) => (
          <button
            key={option.value}
            onClick={() => onMetricChange(option.value)}
            aria-pressed={option.value === metric}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              option.value === metric
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mb-3 px-1 text-xs text-muted-foreground">
        {active.label} de cada mês, no perfil e nos filtros atuais.
      </p>

      <div className="relative">
        <button
          onClick={() => scrollBy(-1)}
          aria-label="Meses anteriores"
          className="absolute -left-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-md transition-colors hover:bg-primary-soft hover:text-primary"
        >
          <ChevronLeft className="size-4" />
        </button>

        <div ref={strip} className="flex gap-2 overflow-x-auto px-6 pb-2">
          {points.map((point) => {
            const isFocus = point.key === selected;
            const isPast = point.key <= thisMonth;
            const both = metric === "income_expense";
            return (
              <button
                key={point.key}
                onClick={() => {
                  const range = monthRange(point.key);
                  setRange(range.from, range.to);
                }}
                aria-pressed={isFocus}
                data-focus={isFocus || undefined}
                className={`flex w-40 shrink-0 flex-col items-center gap-2 rounded-xl border p-3 transition-all ${
                  isFocus
                    ? "border-primary bg-primary-soft shadow-xs"
                    : isPast
                      ? "border-border bg-card hover:border-border-strong hover:bg-accent/50"
                      : "border-dashed border-border bg-card hover:border-border-strong hover:bg-accent/50"
                }`}
              >
                <span
                  className={`text-sm font-semibold ${isFocus ? "text-primary-soft-foreground" : ""}`}
                >
                  {monthChipLabel(point.key, currentYear)}
                </span>

                {/* O ponto na linha do tempo: cheio no passado, vazado no que vem. */}
                <span className="relative flex h-3 w-full items-center">
                  {/* Sai da borda do cartão para cobrir o vão até o vizinho:
                      é o que faz a costura parecer uma linha só. */}
                  <span
                    className={`absolute -inset-x-5 h-px ${
                      isPast ? "bg-primary" : "border-t border-dashed border-border-strong"
                    }`}
                  />
                  <span
                    className={`relative mx-auto rounded-full transition-all ${
                      isFocus
                        ? "size-3 bg-primary ring-4 ring-primary/20"
                        : isPast
                          ? "size-2 bg-primary"
                          : "size-2 border-2 border-border-strong bg-card"
                    }`}
                  />
                </span>

                {both ? (
                  <span className="flex flex-col items-center gap-0.5">
                    <span className="font-mono text-xs font-bold text-positive">
                      {brl(point.income)}
                    </span>
                    <span className="font-mono text-xs font-bold text-negative">
                      {brl(point.expense)}
                    </span>
                  </span>
                ) : (
                  <span
                    className={`font-mono text-sm font-bold ${
                      metric === "expense" || metric === "fixed_expense"
                        ? "text-negative"
                        : metric === "income" || metric === "fixed_income"
                          ? "text-positive"
                          : point.value < 0
                            ? "text-negative"
                            : "text-foreground"
                    }`}
                  >
                    {brl(point.value)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        <button
          onClick={() => scrollBy(1)}
          aria-label="Próximos meses"
          className="absolute -right-1 top-1/2 z-10 -translate-y-1/2 rounded-full border border-border bg-card p-1.5 text-muted-foreground shadow-md transition-colors hover:bg-primary-soft hover:text-primary"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
    </div>
  );
}

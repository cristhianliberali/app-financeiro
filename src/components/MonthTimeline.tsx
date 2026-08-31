import { useEffect, useMemo, useRef } from "react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Clock,
  Minus,
  TrendingDown,
  TrendingUp,
} from "lucide-react";

import { badgeVariants } from "@/components/ui/badge";
import { useAppState } from "@/lib/app-state";
import { useRecurring, useTransactions } from "@/lib/data";
import { MONTH_METRICS, monthTimeline, type MonthMetric, type MonthPoint } from "@/lib/analytics";
import {
  brl,
  monthChipLabel,
  monthKeyOf,
  monthRange,
  monthTitle,
  shiftMonthKey,
  toISODate,
} from "@/lib/format";

/** Quantos meses a faixa cobre para cada lado do mês em foco. */
const BACK = 5;
const FORWARD = 6;

/**
 * Um mês a mais na frente da faixa, que não vira cartão.
 *
 * O rodapé de cada cartão compara o mês com o anterior, e o primeiro cartão da
 * faixa também precisa de com quem se comparar. Este mês entra na conta e sai
 * da tela.
 */
const ANCHOR = 1;

/** Em que ponto do calendário o mês está — é o que o selo do cartão diz. */
type MonthState = "closed" | "current" | "forecast";

const MONTH_STATE: Record<
  MonthState,
  { label: string; icon: typeof CircleCheck | null; variant: "secondary" | "default" | "outline" }
> = {
  closed: { label: "Fechado", icon: CircleCheck, variant: "secondary" },
  current: { label: "Atual", icon: null, variant: "default" },
  forecast: { label: "Previsto", icon: Clock, variant: "outline" },
};

/** Métricas em que subir é má notícia: gasto que cresce não é ganho. */
const LOWER_IS_BETTER: MonthMetric[] = ["expense", "fixed_expense"];

/**
 * A variação de um mês para o anterior, já com o tom certo.
 *
 * A porcentagem vem sem sinal: quem diz a direção é a seta, e repetir o menos
 * ao lado dela só faria o número tropeçar. Sem mês anterior com valor, não há
 * base de comparação e o rodapé mostra um traço em vez de inventar 100%.
 */
function trendOf(value: number, previous: number, metric: MonthMetric) {
  const diff = value - previous;
  const flat = diff === 0;
  const up = diff > 0;
  const good = LOWER_IS_BETTER.includes(metric) ? !up : up;

  return {
    icon: flat ? Minus : up ? TrendingUp : TrendingDown,
    tone: flat ? "text-muted-foreground" : good ? "text-positive" : "text-negative",
    label: previous === 0 ? (flat ? "0%" : "—") : `${Math.round(Math.abs(diff / previous) * 100)}%`,
  };
}

/**
 * Linha do tempo de meses do painel.
 *
 * O painel mostrava um mês por vez e nada do que vinha antes ou depois: para
 * comparar agosto com julho era preciso trocar o período, olhar, e voltar. Aqui
 * cada mês vizinho é um cartão com o total, a divisão entre o que entra e o que
 * sai, e quanto isso mudou desde o mês anterior; o mês em foco é o cartão
 * destacado, e clicar em qualquer outro leva o painel inteiro para lá.
 *
 * A faixa também anda no arrasto do mouse — é mais rápido do que mirar as setas
 * quando se quer percorrer o ano inteiro. Um arrasto não vira clique: o cartão
 * onde o botão foi solto só troca o período se o ponteiro não tiver andado.
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
    () =>
      Array.from({ length: ANCHOR + BACK + FORWARD + 1 }, (_, i) =>
        shiftMonthKey(focus, i - BACK - ANCHOR),
      ),
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

  // ---- Arrasto da faixa -----------------------------------------------------
  // `moved` sobrevive até o próximo `pointerdown` de propósito: o `click` do
  // cartão dispara depois do `pointerup`, e é ele que precisa saber que o que
  // acabou de acontecer foi um arrasto, não uma escolha de mês.
  const drag = useRef({ active: false, startX: 0, startScroll: 0, moved: false });

  function onPointerDown(event: React.PointerEvent) {
    // No toque o navegador já rola sozinho, e melhor: com inércia.
    if (event.pointerType === "touch" || !strip.current) return;
    drag.current = {
      active: true,
      startX: event.clientX,
      startScroll: strip.current.scrollLeft,
      moved: false,
    };
  }

  function onPointerMove(event: React.PointerEvent) {
    if (!drag.current.active || !strip.current) return;
    const dx = event.clientX - drag.current.startX;
    // Uma folga antes de virar arrasto, para o tremor da mão no clique não
    // sequestrar a escolha do mês.
    if (Math.abs(dx) > 4) drag.current.moved = true;
    if (drag.current.moved) strip.current.scrollLeft = drag.current.startScroll - dx;
  }

  function endDrag() {
    drag.current.active = false;
  }

  const active = MONTH_METRICS.find((m) => m.value === metric) ?? MONTH_METRICS[0]!;
  const both = metric === "income_expense";

  /** A cor do número em destaque segue o que a métrica mede. */
  function figureTone(point: MonthPoint) {
    if (metric === "expense" || metric === "fixed_expense") return "text-negative";
    if (metric === "income" || metric === "fixed_income") return "text-positive";
    return point.value < 0 ? "text-negative" : "text-positive";
  }

  return (
    <div className="panel p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="size-2 shrink-0 rounded-full bg-primary" />
          <span className="label-caps text-foreground">Linha do tempo de meses</span>
          <span className="truncate text-xs text-muted-foreground">
            (Arraste ou clique para navegar)
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => scrollBy(-1)}
            aria-label="Meses anteriores"
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            onClick={() => scrollBy(1)}
            aria-label="Próximos meses"
            className="rounded-lg border border-border bg-card p-1.5 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

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
      <p className="mb-2 px-1 text-xs text-muted-foreground">
        {active.label} de cada mês, no perfil e nos filtros atuais.
      </p>

      <div
        ref={strip}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
        onPointerCancel={endDrag}
        className="flex cursor-grab select-none gap-3 overflow-x-auto px-0.5 py-2 active:cursor-grabbing"
      >
        {points.slice(ANCHOR).map((point, index) => {
          const previous = points[index]!;
          const isFocus = point.key === selected;
          const state: MonthState =
            point.key < thisMonth ? "closed" : point.key === thisMonth ? "current" : "forecast";
          const badge = MONTH_STATE[state];
          const trend = trendOf(point.value, previous.value, metric);
          const flow = point.income + point.expense;

          return (
            <button
              key={point.key}
              onClick={() => {
                if (drag.current.moved) return;
                const range = monthRange(point.key);
                setRange(range.from, range.to);
              }}
              aria-pressed={isFocus}
              data-focus={isFocus || undefined}
              title={monthTitle(point.key)}
              className={`relative flex w-56 shrink-0 flex-col gap-3 rounded-xl border p-4 text-left transition-all ${
                isFocus
                  ? "border-primary bg-primary-soft glow-strong"
                  : "border-border bg-card hover:border-border-strong hover:bg-accent/50"
              }`}
            >
              {/* A aba no topo é o que amarra o cartão em foco ao painel: ela
                  diz "é este que o resto da tela está mostrando". */}
              {isFocus && (
                <span className="absolute -top-0.5 left-1/2 h-1 w-12 -translate-x-1/2 rounded-full bg-primary" />
              )}

              <span className="flex items-center justify-between gap-2">
                <span
                  className={`truncate text-base font-bold tracking-tight ${
                    isFocus ? "text-primary-soft-foreground" : ""
                  }`}
                >
                  {monthChipLabel(point.key, currentYear)}
                </span>
                <span
                  className={`${badgeVariants({ variant: badge.variant })} shrink-0 px-2 text-[10px]`}
                >
                  {badge.icon && <badge.icon />}
                  {badge.label}
                </span>
              </span>

              {both ? (
                <span className="flex flex-col gap-0.5">
                  <span className="font-mono text-base font-bold text-positive">
                    {brl(point.income)}
                  </span>
                  <span className="font-mono text-base font-bold text-negative">
                    {brl(point.expense)}
                  </span>
                </span>
              ) : (
                <span className="flex flex-col gap-1.5">
                  <span
                    className={`font-mono text-xl font-bold tracking-tight ${figureTone(point)}`}
                  >
                    {brl(point.value)}
                  </span>
                  <span className="flex items-center justify-between gap-2 font-mono text-[11px] font-semibold">
                    <span className="text-positive">+{brl(point.income)}</span>
                    <span className="text-negative">-{brl(point.expense)}</span>
                  </span>
                </span>
              )}

              {/* A barra é a proporção entre o que entrou e o que saiu no mês:
                  dois números viram uma imagem que se lê sem contar zeros. */}
              <span className="flex h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                {flow > 0 && (
                  <>
                    <span
                      className="bg-positive"
                      style={{ width: `${(point.income / flow) * 100}%` }}
                    />
                    <span
                      className="bg-negative"
                      style={{ width: `${(point.expense / flow) * 100}%` }}
                    />
                  </>
                )}
              </span>

              <span className="flex items-center justify-between gap-2 border-t border-border pt-2.5 text-[11px]">
                <span className="text-muted-foreground">vs anterior</span>
                <span className={`flex items-center gap-1 font-mono font-semibold ${trend.tone}`}>
                  <trend.icon className="size-3" />
                  {trend.label}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { ArrowRight, CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";

import { useAppState } from "@/lib/app-state";
import {
  monthKeyOf,
  monthRange,
  monthTitle,
  shiftMonthKey,
  toISODate,
  wholeMonthOf,
} from "@/lib/format";
import { DateField } from "@/components/ui/date-field";

/**
 * Barra de período do módulo Finanças.
 *
 * Ela morava espremida no cabeçalho, ao lado dos seletores de conta e perfil, e
 * o recorte — que é o que muda tudo o que a tela mostra — ficava do tamanho de
 * um detalhe. Aqui ela ocupa a largura toda, logo abaixo do cabeçalho, e o mês
 * vira o centro: as setas andam de mês em mês, que é o passo em que se pensa
 * dinheiro, e o nome do mês diz onde se está sem precisar ler duas datas.
 *
 * As setas só fazem sentido quando o recorte é um mês fechado. Num intervalo
 * qualquer ("7 dias", ou datas digitadas na mão) elas somem e a barra mostra o
 * próprio intervalo — andar "um mês" a partir de um pedaço de mês não teria um
 * resultado óbvio.
 */
export function PeriodBar() {
  const { dateBasis, setDateBasis, from, to, setRange } = useAppState();

  const month = wholeMonthOf(from, to);
  const today = new Date();
  const thisMonth = monthKeyOf(toISODate(today));

  function goToMonth(key: string) {
    const range = monthRange(key);
    setRange(range.from, range.to);
  }

  const presets: Array<{ label: string; apply: () => void; active: boolean }> = [
    {
      label: "Hoje",
      apply: () => setRange(toISODate(today), toISODate(today)),
      active: from === toISODate(today) && to === toISODate(today),
    },
    {
      label: "7 dias",
      apply: () => {
        const start = new Date(today);
        start.setDate(start.getDate() - 6);
        setRange(toISODate(start), toISODate(today));
      },
      active: false,
    },
    { label: "Este mês", apply: () => goToMonth(thisMonth), active: month === thisMonth },
    {
      label: "Este ano",
      apply: () =>
        setRange(
          toISODate(new Date(today.getFullYear(), 0, 1)),
          toISODate(new Date(today.getFullYear(), 11, 31)),
        ),
      active:
        from === toISODate(new Date(today.getFullYear(), 0, 1)) &&
        to === toISODate(new Date(today.getFullYear(), 11, 31)),
    },
  ];

  return (
    <div className="panel flex flex-wrap items-center gap-x-3 gap-y-2 p-2">
      {/* Mês, com as setas de vizinhança. */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => month && goToMonth(shiftMonthKey(month, -1))}
          disabled={!month}
          aria-label="Mês anterior"
          title="Mês anterior"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="min-w-40 text-center text-sm font-bold tracking-tight first-letter:uppercase">
          {month ? monthTitle(month) : "Período personalizado"}
        </span>
        <button
          onClick={() => month && goToMonth(shiftMonthKey(month, 1))}
          disabled={!month}
          aria-label="Próximo mês"
          title="Próximo mês"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:pointer-events-none disabled:opacity-30"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="hidden h-6 w-px bg-border sm:block" />

      <div className="flex flex-wrap gap-0.5">
        {presets.map((preset) => (
          <button
            key={preset.label}
            onClick={preset.apply}
            aria-pressed={preset.active}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
              preset.active
                ? "bg-primary text-primary-foreground shadow-xs"
                : "text-muted-foreground hover:bg-accent hover:text-foreground"
            }`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-border px-1.5 py-1">
        <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" />
        <DateField
          value={from}
          onChange={(e) => setRange(e.target.value, to)}
          aria-label="Início do período"
          className="h-8 w-[8.75rem] rounded-lg border-transparent bg-transparent text-xs shadow-none"
        />
        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        <DateField
          value={to}
          onChange={(e) => setRange(from, e.target.value)}
          aria-label="Fim do período"
          className="h-8 w-[8.75rem] rounded-lg border-transparent bg-transparent text-xs shadow-none"
        />
      </div>

      {/* A base da data fica à direita: é a escolha que menos muda no dia a dia. */}
      <div className="ml-auto flex items-center gap-2">
        <span className="label-caps hidden lg:inline">Considerar</span>
        <div className="flex rounded-lg bg-secondary p-0.5 text-[10px] font-bold uppercase tracking-wider">
          {(
            [
              ["transaction_date", "Transação"],
              ["due_date", "Vencimento"],
            ] as const
          ).map(([basis, label]) => (
            <button
              key={basis}
              onClick={() => setDateBasis(basis)}
              className={`rounded-[4px] px-2.5 py-1.5 transition-all ${
                dateBasis === basis
                  ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

import { ArrowRight } from "lucide-react";

import { useAppState } from "@/lib/app-state";
import { toISODate } from "@/lib/format";
import { DateField } from "@/components/ui/date-field";

const presets = [
  {
    label: "Mês",
    range: () => {
      const d = new Date();
      return [
        toISODate(new Date(d.getFullYear(), d.getMonth(), 1)),
        toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      ] as const;
    },
  },
  {
    label: "Trimestre",
    range: () => {
      const d = new Date();
      return [
        toISODate(new Date(d.getFullYear(), d.getMonth() - 2, 1)),
        toISODate(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
      ] as const;
    },
  },
  {
    label: "Ano",
    range: () => {
      const d = new Date();
      return [
        toISODate(new Date(d.getFullYear(), 0, 1)),
        toISODate(new Date(d.getFullYear(), 11, 31)),
      ] as const;
    },
  },
];

/**
 * Recorte de período do módulo Finanças: a base da data (transação ou
 * vencimento), o intervalo e três saltos rápidos. Fica no cabeçalho, então
 * tudo aqui é compacto — os campos usam a variante baixa do `DateField`.
 */
export function PeriodControls() {
  const { dateBasis, setDateBasis, from, to, setRange } = useAppState();

  return (
    <div className="flex flex-wrap items-center gap-2">
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
            className={`rounded-[7px] px-2.5 py-1.5 transition-all ${
              dateBasis === basis
                ? "bg-card text-foreground shadow-xs ring-1 ring-border"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1 rounded-xl border border-border bg-card px-1 py-1 shadow-xs">
        <DateField
          value={from}
          onChange={(e) => setRange(e.target.value, to)}
          aria-label="Início do período"
          className="h-8 w-[9.5rem] rounded-lg border-transparent bg-transparent text-xs shadow-none"
        />
        <ArrowRight className="size-3 shrink-0 text-muted-foreground" />
        <DateField
          value={to}
          onChange={(e) => setRange(from, e.target.value)}
          aria-label="Fim do período"
          className="h-8 w-[9.5rem] rounded-lg border-transparent bg-transparent text-xs shadow-none"
        />
      </div>

      <div className="hidden gap-0.5 sm:flex">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              const [f, t] = p.range();
              setRange(f, t);
            }}
            className="rounded-lg px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

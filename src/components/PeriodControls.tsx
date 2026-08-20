import { useAppState } from "@/lib/app-state";
import { toISODate } from "@/lib/format";

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
      return [toISODate(new Date(d.getFullYear(), 0, 1)), toISODate(new Date(d.getFullYear(), 11, 31))] as const;
    },
  },
];

export function PeriodControls() {
  const { dateBasis, setDateBasis, from, to, setRange } = useAppState();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex rounded-lg bg-secondary p-1 text-[10px] font-bold uppercase tracking-wider">
        <button
          onClick={() => setDateBasis("transaction_date")}
          className={`rounded px-3 py-1 transition-colors ${
            dateBasis === "transaction_date"
              ? "bg-card shadow-sm text-foreground"
              : "text-muted-foreground"
          }`}
        >
          Data transação
        </button>
        <button
          onClick={() => setDateBasis("due_date")}
          className={`rounded px-3 py-1 transition-colors ${
            dateBasis === "due_date" ? "bg-card shadow-sm text-foreground" : "text-muted-foreground"
          }`}
        >
          Vencimento
        </button>
      </div>
      <div className="flex items-center gap-1">
        <input
          type="date"
          value={from}
          onChange={(e) => setRange(e.target.value, to)}
          className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground">→</span>
        <input
          type="date"
          value={to}
          onChange={(e) => setRange(from, e.target.value)}
          className="rounded-md border border-border bg-card px-2 py-1 font-mono text-xs outline-none focus:ring-1 focus:ring-ring"
        />
      </div>
      <div className="hidden gap-1 sm:flex">
        {presets.map((p) => (
          <button
            key={p.label}
            onClick={() => {
              const [f, t] = p.range();
              setRange(f, t);
            }}
            className="rounded-md px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
      </div>
    </div>
  );
}

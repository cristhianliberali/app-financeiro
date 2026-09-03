import { ArrowDownRight, ArrowUpRight, Scale } from "lucide-react";

import { brl } from "@/lib/format";
import type { ConsultaResult } from "@/lib/chat-contract";

/**
 * O resultado numérico de uma consulta.
 *
 * A frase acima do cartão já responde a pergunta; o cartão existe para o que
 * vem depois dela — a barra do teto, que diz de olho quanto sobrou, e a quebra
 * por categoria, que responde "para onde foi" sem exigir uma segunda pergunta.
 *
 * Nada aqui é calculado: todos os valores vêm do servidor, somados no banco.
 */
export function ChatConsultaCard({ consulta }: { consulta: ConsultaResult }) {
  const { metrica, teto, porCategoria } = consulta;
  const gasto = consulta.saidas;
  const usoDoTeto = teto && teto > 0 ? Math.min(100, (gasto / teto) * 100) : null;
  const estourou = teto !== null && gasto > teto;
  const maior = porCategoria[0]?.total ?? 0;

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-border bg-background/60 p-3">
      {metrica === "saldo" ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Numero rotulo="Entradas" valor={consulta.entradas} tom="text-positive" />
          <Numero rotulo="Saídas" valor={consulta.saidas} tom="text-negative" />
          <Numero
            rotulo="Saldo"
            valor={consulta.saldo}
            tom={consulta.saldo >= 0 ? "text-positive" : "text-negative"}
          />
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {metrica === "entradas" ? (
            <ArrowUpRight className="size-4 shrink-0 text-positive" />
          ) : (
            <ArrowDownRight className="size-4 shrink-0 text-negative" />
          )}
          <span className="text-lg font-semibold tabular-nums">
            {brl(metrica === "entradas" ? consulta.entradas : consulta.saidas)}
          </span>
          <span className="ml-auto text-xs text-muted-foreground">
            {consulta.lancamentos} {consulta.lancamentos === 1 ? "lançamento" : "lançamentos"}
          </span>
        </div>
      )}

      {usoDoTeto !== null && (
        <div className="space-y-1">
          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full ${estourou ? "bg-negative" : "bg-primary"}`}
              style={{ width: `${usoDoTeto}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Teto de {brl(teto!)} no período
            {consulta.categoria ? ` em ${consulta.categoria.name}` : ""}.
          </p>
        </div>
      )}

      {porCategoria.length > 0 && (
        <div className="space-y-1.5">
          <p className="label-caps text-[0.6rem]">Por categoria</p>
          {porCategoria.map((categoria) => (
            <div key={categoria.id ?? "sem-categoria"} className="flex items-center gap-2 text-xs">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: categoria.color }}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate">{categoria.name}</span>
              {/* Barra proporcional à maior categoria: a comparação entre elas
                  é o que interessa aqui, não a fração do total. */}
              <span className="hidden h-1 w-16 overflow-hidden rounded-full bg-muted sm:block">
                <span
                  className="block h-full rounded-full bg-primary/60"
                  style={{ width: `${maior > 0 ? (categoria.total / maior) * 100 : 0}%` }}
                />
              </span>
              <span className="shrink-0 font-medium tabular-nums">{brl(categoria.total)}</span>
            </div>
          ))}
        </div>
      )}

      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Scale className="size-3 shrink-0" />
        {consulta.periodo.label} · somado direto no banco, sem passar pela IA
      </p>
    </div>
  );
}

function Numero({ rotulo, valor, tom }: { rotulo: string; valor: number; tom: string }) {
  return (
    <div>
      <p className="label-caps text-[0.6rem]">{rotulo}</p>
      <p className={`text-sm font-semibold tabular-nums ${tom}`}>{brl(valor)}</p>
    </div>
  );
}

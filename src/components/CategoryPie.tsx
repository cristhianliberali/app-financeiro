import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

import { brl } from "@/lib/format";
import { PIE_TOOLTIP } from "@/lib/chart-theme";

/**
 * A rosca de categorias do painel — despesas de um lado, entradas do outro.
 *
 * Vivia dentro da rota do painel, o que só se percebe como problema quando se
 * quer olhar para ela sozinha: a rota exige sessão e banco, e a rosca não exige
 * nada além de uma lista de números.
 */

export type CategorySlice = { id: string; name: string; color: string; value: number };

export function CategoryPie({
  data,
}: {
  data: Array<{ id: string; name: string; color: string; value: number }>;
}) {
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">Sem dados no período.</p>;
  }
  const total = data.reduce((sum, d) => sum + d.value, 0);

  return (
    <div className="space-y-3">
      {/* Mais alto que os 14rem de antes: com um anel de 30px de espessura,
          fatia pequena não tinha onde aparecer e as cores viravam fios. */}
      <div className="h-72 sm:h-80">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              /* Raio em porcentagem, e não em pixels fixos: assim o anel cresce
                 com o cartão. Era o que faltava no celular, onde o cartão ocupa
                 a largura toda e mesmo assim a pizza continuava do tamanho que
                 cabia numa coluna de um terço do desktop. */
              innerRadius="52%"
              outerRadius="82%"
              paddingAngle={2}
              stroke="var(--color-card)"
              strokeWidth={2}
            >
              {data.map((d) => (
                <Cell key={d.id} fill={d.color} />
              ))}
            </Pie>
            <Tooltip {...PIE_TOOLTIP} formatter={(v: number) => brl(v)} />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {/*
        Legenda em HTML, fora do gráfico.
        A do Recharts mora dentro do SVG e é cortada pela altura do contêiner —
        no celular, com sete ou oito categorias, sobrava meia linha de nomes
        picados. Aqui ela é uma lista comum: quebra quantas linhas precisar,
        cada nome corta com reticências em vez de sumir, e ainda cabe a fatia em
        porcentagem, que é o que a pizza não sabe dizer sozinha.
      */}
      {/* Duas colunas só na largura de tablet. No `lg` o cartão volta a ser um
          terço da fileira, e ali duas colunas espremem o nome a ponto de cortar
          "Transporte e combustível" no meio — uma coluna cabe inteiro. */}
      <ul className="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 lg:grid-cols-1">
        {data.map((d) => (
          <li key={d.id} className="flex items-center gap-1.5 text-[11px]" title={d.name}>
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: d.color }}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.name}</span>
            <span className="shrink-0 font-mono font-semibold" data-numeric>
              {total > 0 ? Math.round((d.value / total) * 100) : 0}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

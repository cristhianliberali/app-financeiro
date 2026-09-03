/**
 * A caixa que aparece quando o ponteiro encosta num gráfico.
 *
 * O Recharts desenha a dele com estilo embutido: fundo branco fixo, borda
 * cinza, rótulo apagado. No tema claro isso quase passa; no escuro é um
 * retângulo branco no meio da tela, e o texto cinza sobre branco fica no
 * limite do ilegível. Como o estilo vem inline no elemento, nenhuma regra de
 * CSS nossa o alcança — a única forma de corrigir é passar os objetos abaixo
 * em cada gráfico.
 *
 * Tudo em variáveis do tema, e não em cores fixas: assim a caixa acompanha
 * claro e escuro sem uma segunda definição.
 */
export const TOOLTIP_STYLE = {
  borderRadius: 12,
  border: "1px solid var(--color-border)",
  background: "var(--color-popover)",
  color: "var(--color-popover-foreground)",
  boxShadow: "var(--elevation-lg)",
  fontSize: 12,
} as const;

/** O rótulo (a data, o nome da fatia) — some no cinza padrão do Recharts. */
export const TOOLTIP_LABEL_STYLE = {
  color: "var(--color-muted-foreground)",
  fontWeight: 600,
  marginBottom: 2,
} as const;

export const TOOLTIP_ITEM_STYLE = { color: "var(--color-popover-foreground)" } as const;

/**
 * O realce da faixa sob o ponteiro, nos gráficos de barra.
 *
 * O padrão é um `#ccc` chapado: numa tela escura vira uma mancha clara maior
 * que a própria barra, e num gráfico de barra única ela cobre o gráfico
 * inteiro. Apagá-lo perderia a indicação de qual faixa está sendo lida, então
 * ele fica — em tinta do próprio tema, com 6% de opacidade, que marca a faixa
 * sem competir com a barra.
 */
export const BAR_CURSOR = { fill: "var(--color-foreground)", fillOpacity: 0.06 } as const;

/** Nos gráficos de linha o cursor é um traço vertical, não um retângulo. */
export const LINE_CURSOR = { stroke: "var(--color-border-strong)", strokeWidth: 1 } as const;

/** Espalhe num `<Tooltip>` de barras: `<Tooltip {...BAR_TOOLTIP} formatter={…} />`. */
export const BAR_TOOLTIP = {
  contentStyle: TOOLTIP_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
  itemStyle: TOOLTIP_ITEM_STYLE,
  cursor: BAR_CURSOR,
} as const;

export const LINE_TOOLTIP = {
  contentStyle: TOOLTIP_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
  itemStyle: TOOLTIP_ITEM_STYLE,
  cursor: LINE_CURSOR,
} as const;

/** Pizza não tem faixa para realçar: só a caixa. */
export const PIE_TOOLTIP = {
  contentStyle: TOOLTIP_STYLE,
  labelStyle: TOOLTIP_LABEL_STYLE,
  itemStyle: TOOLTIP_ITEM_STYLE,
} as const;

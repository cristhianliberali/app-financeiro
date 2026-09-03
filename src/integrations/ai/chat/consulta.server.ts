/**
 * Execução da consulta que o modelo pediu.
 *
 * Todo número que a pessoa lê no chat nasce aqui, de um `SUM` no banco. O
 * modelo escolheu a métrica, a categoria e o período; a soma é do Postgres, e
 * a frase é montada em `resumoConsulta` a partir dela. É o que torna
 * impossível o chat responder um valor que não existe no extrato.
 *
 * O recorte segue o do resto do app: `transaction_date` (a data em que o
 * movimento aconteceu) e todos os lançamentos do período, pagos ou em aberto —
 * os mesmos totais que o painel mostra para o mesmo intervalo.
 */
import { query } from "../../postgres/client.server";
import { requireProfileAccess } from "../../postgres/access.server";
import {
  resolvePeriodo,
  tetoDoPeriodo,
  type ConsultaCategoria,
  type ConsultaIntent,
  type ConsultaResult,
} from "@/lib/chat-contract";

import { casarCategoria, type CategoriaRef } from "./categorias";

type LinhaAgregada = {
  kind: "income" | "expense";
  category_id: string | null;
  total: number;
  lancamentos: number;
};

/** Categorias da subconta, no formato que o casamento por nome espera. */
export async function listarCategoriasRef(profileId: string): Promise<CategoriaRef[]> {
  return query<CategoriaRef>(
    `SELECT id, name, kind, color, monthly_cap, description,
            to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS archived_at
       FROM categories WHERE profile_id = $1 ORDER BY name`,
    [profileId],
  );
}

export async function executarConsulta(input: {
  userId: string;
  profileId: string;
  intent: ConsultaIntent;
  hoje: string;
  categorias: CategoriaRef[];
}): Promise<ConsultaResult> {
  await requireProfileAccess(input.userId, input.profileId, "viewer");

  const periodo = resolvePeriodo(input.intent.periodo, input.hoje);

  // Consulta enxerga categoria arquivada: perguntar "quanto gastei em X no ano
  // passado" tem de responder mesmo que X não receba lançamento novo hoje.
  const categoria = casarCategoria(input.intent.categoria, input.categorias, {
    incluirArquivadas: true,
    ...(input.intent.metrica === "gastos" ? { kind: "expense" as const } : {}),
    ...(input.intent.metrica === "entradas" ? { kind: "income" as const } : {}),
  });

  const params: unknown[] = [input.profileId, periodo.from, periodo.to];
  let sql = `SELECT kind, category_id, SUM(amount) AS total, COUNT(*) AS lancamentos
       FROM transactions
      WHERE profile_id = $1 AND transaction_date BETWEEN $2 AND $3`;
  if (categoria) sql += ` AND category_id = $${params.push(categoria.id)}`;
  sql += " GROUP BY kind, category_id";

  const linhas = await query<LinhaAgregada>(sql, params);

  const entradas = linhas
    .filter((linha) => linha.kind === "income")
    .reduce((soma, linha) => soma + linha.total, 0);
  const saidas = linhas
    .filter((linha) => linha.kind === "expense")
    .reduce((soma, linha) => soma + linha.total, 0);

  /*
   * Quantos lançamentos a resposta considerou. Numa consulta de saldo são os
   * dois lados; numa de gastos, só as despesas — dizer "nenhum lançamento"
   * porque o mês só teve receitas seria mentira ao contrário.
   */
  const relevantes = linhas.filter((linha) => {
    if (input.intent.metrica === "saldo") return true;
    return linha.kind === (input.intent.metrica === "entradas" ? "income" : "expense");
  });
  const lancamentos = relevantes.reduce((soma, linha) => soma + linha.lancamentos, 0);

  return {
    metrica: input.intent.metrica,
    periodo,
    categoria: categoria
      ? {
          id: categoria.id,
          name: categoria.name,
          color: categoria.color,
          monthlyCap: categoria.monthly_cap,
        }
      : null,
    // Só é "não encontrada" quando a pessoa pediu uma e nenhuma casou.
    categoriaNaoEncontrada: input.intent.categoria && !categoria ? input.intent.categoria : null,
    entradas,
    saidas,
    saldo: entradas - saidas,
    lancamentos,
    teto: categoria ? tetoDoPeriodo(categoria.monthly_cap, periodo) : null,
    porCategoria: categoria ? [] : quebraPorCategoria(linhas, input),
  };
}

/**
 * As categorias que compõem o total, da maior para a menor.
 *
 * É o que transforma "gastei 3.200 este mês" em uma resposta útil: a tela
 * mostra as primeiras logo abaixo da frase, e a pessoa vê para onde o dinheiro
 * foi sem precisar de uma segunda pergunta.
 */
function quebraPorCategoria(
  linhas: LinhaAgregada[],
  input: { intent: ConsultaIntent; categorias: CategoriaRef[] },
): ConsultaCategoria[] {
  const lado = input.intent.metrica === "entradas" ? "income" : "expense";
  return linhas
    .filter((linha) => linha.kind === lado && linha.total > 0)
    .map((linha) => {
      const categoria = input.categorias.find((item) => item.id === linha.category_id);
      return {
        id: linha.category_id,
        name: categoria?.name ?? "Sem categoria",
        color: categoria?.color ?? "#94A3B8",
        total: linha.total,
      };
    })
    .sort((a, b) => b.total - a.total)
    .slice(0, 6);
}

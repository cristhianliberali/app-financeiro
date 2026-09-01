/**
 * Cache de merchants no Postgres — o que faz o custo de categorização tender a
 * zero entre importações e entre reinícios do container.
 *
 * O escopo é global de propósito: `MERCADOLIVRE*`, `APPLE.COM/BILL` e
 * `DM *Spotify` significam a mesma coisa para a base inteira. O rótulo é o
 * **nome** da categoria, não o id — id é por perfil, nome viaja entre perfis;
 * quem consome o cache confere se o perfil tem uma categoria com aquele nome e
 * trata a ausência como cache vazio.
 *
 * O acesso é em lote (uma consulta para todas as chaves, um upsert para todos
 * os rótulos novos): uma fatura tem centena e meia de linhas, e ida por ida ao
 * banco custaria mais que a própria requisição de IA.
 */
import { query } from "../../postgres/client.server";
import { chaveMerchant, type RotuloMerchant } from "./merchants.server";

export type RotuloComOrigem = RotuloMerchant & { origem: "ia" | "usuario" };

/** Rótulos conhecidos para as chaves pedidas. Chaves já normalizadas ou não. */
export async function carregarRotulos(
  descritores: readonly string[],
): Promise<Map<string, RotuloMerchant>> {
  const chaves = [...new Set(descritores.map(chaveMerchant))].filter((chave) => chave !== "");
  if (chaves.length === 0) return new Map();

  const linhas = await query<{ chave: string; categoria: string; confianca: string }>(
    `SELECT chave, categoria, confianca FROM merchant_labels WHERE chave = ANY($1::text[])`,
    [chaves],
  );
  return new Map(
    linhas.map((linha) => [
      linha.chave,
      { categoria: linha.categoria, confianca: Number(linha.confianca) },
    ]),
  );
}

/**
 * Grava rótulos novos. Correção humana (`origem = 'usuario'`) vale mais que
 * palpite de modelo: a IA nunca sobrescreve o que uma pessoa confirmou, e uma
 * pessoa sempre sobrescreve o que a IA chutou.
 */
export async function gravarRotulos(rotulos: ReadonlyMap<string, RotuloComOrigem>): Promise<void> {
  const entradas = [...rotulos.entries()].filter(([chave]) => chave !== "");
  if (entradas.length === 0) return;

  await query(
    `INSERT INTO merchant_labels (chave, categoria, confianca, origem, updated_at)
     SELECT * FROM unnest($1::text[], $2::text[], $3::numeric[], $4::text[],
                          array_fill(now(), ARRAY[cardinality($1::text[])]))
     ON CONFLICT (chave) DO UPDATE
        SET categoria = EXCLUDED.categoria,
            confianca = EXCLUDED.confianca,
            origem = EXCLUDED.origem,
            updated_at = now()
      WHERE merchant_labels.origem = 'ia' OR EXCLUDED.origem = 'usuario'`,
    [
      entradas.map(([chave]) => chave),
      entradas.map(([, rotulo]) => rotulo.categoria),
      entradas.map(([, rotulo]) => rotulo.confianca),
      entradas.map(([, rotulo]) => rotulo.origem),
    ],
  );
}

import { Repeat } from "lucide-react";

import type { Transaction } from "@/lib/data";

/**
 * Marca, na lista, o lançamento que nasceu de uma recorrência.
 *
 * Depois que as regras passaram a gerar lançamentos de verdade, o extrato
 * ficou com dois tipos de linha de aparência idêntica: a que alguém digitou e
 * a que a regra criou sozinha. Quem analisa o mês precisa dessa diferença —
 * ela muda o que fazer com a linha. Apagar uma cobrança avulsa resolve; apagar
 * uma da série é enxugar gelo, porque no mês seguinte ela volta.
 *
 * Fica do tamanho do selo de parcela, que já existia na mesma linha e resolve
 * o mesmo tipo de pergunta. Um ícone, sem texto: o extrato é para ser lido em
 * diagonal, e uma palavra a mais em cada linha atrapalharia justamente a
 * leitura que o selo quer facilitar.
 */
export function RecurringTag({ transaction }: { transaction: Transaction }) {
  if (!transaction.recurring_rule_id) return null;

  /*
   * "estimado" só enquanto a conta não foi paga.
   *
   * Numa recorrência de valor variável o número da linha é um palpite até
   * alguém confirmar. Depois da baixa ele é o valor real, e continuar
   * chamando-o de estimado seria mentir na direção contrária.
   */
  const estimado = transaction.recurring_variable && transaction.status !== "paid";

  return (
    <span
      title={
        estimado
          ? "Recorrência de valor variável — o valor é uma estimativa até a baixa"
          : "Lançamento gerado por uma recorrência"
      }
      className={`ml-2 inline-flex translate-y-px items-center gap-1 rounded-md px-1.5 py-0.5 align-middle text-[10px] font-semibold ${
        estimado
          ? "bg-warning-soft text-warning-soft-foreground"
          : "bg-secondary text-muted-foreground"
      }`}
    >
      <Repeat className="size-2.5" aria-hidden />
      <span className="sr-only">Recorrente</span>
      {estimado && <span aria-hidden>estimado</span>}
    </span>
  );
}

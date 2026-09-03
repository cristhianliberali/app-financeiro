import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { interpretarWebhook, segredoDoCorpo } from "@/integrations/cakto/contrato";
import { avaliarPlano } from "@/lib/plano";

/**
 * Os oito webhooks reais desta conta na Cakto.
 *
 * As fixtures em `test/fixtures/cakto/` são capturas de verdade, com a
 * estrutura preservada byte a byte e apenas os dados pessoais e o segredo
 * substituídos por marcadores — o que se protege aqui é o *formato*, e ele está
 * intacto.
 *
 * Elas existem porque a documentação da Cakto e o que ela manda não são a mesma
 * coisa, e a diferença não era cosmética: `data` chega como **lista**, não como
 * objeto. Com o leitor escrito só para o objeto documentado, todo campo saía
 * nulo e nenhuma compra liberava acesso. Este arquivo é a trava contra
 * regressão nesse ponto e em tudo o mais que só os payloads reais revelaram.
 */

function carregar(nome: string): unknown {
  return JSON.parse(readFileSync(`test/fixtures/cakto/${nome}.json`, "utf8"));
}

/** Evento -> status esperado, para os oito payloads reais. */
const ESPERADO = [
  ["purchase_approved", "ativo"],
  ["subscription_created", "ativo"],
  ["subscription_resumed", "ativo"],
  ["subscription_renewal_refused", "atrasado"],
  ["subscription_paused", "pausado"],
  ["subscription_canceled", "cancelado"],
  ["refund", "reembolsado"],
  ["chargeback", "chargeback"],
] as const;

describe("payloads reais da Cakto", () => {
  test.each(ESPERADO)("%s vira o status %s", (nome, status) => {
    const lido = interpretarWebhook(carregar(nome));
    expect(lido).not.toBeNull();
    expect(lido!.evento).toBe(nome);
    expect(lido!.status).toBe(status);
  });

  test("`data` é uma lista, e mesmo assim os campos são encontrados", () => {
    // O bug que estas fixtures pegaram: a documentação descreve `data` como
    // objeto, a Cakto manda `data: [ {...} ]`. Lendo só o objeto, tudo isto
    // voltava nulo e todo webhook virava "sem conta correspondente".
    const corpo = carregar("purchase_approved") as { data: unknown[] };
    expect(Array.isArray(corpo.data)).toBe(true);

    const lido = interpretarWebhook(corpo)!;
    expect(lido.email).toBe("cliente@exemplo.com");
    expect(lido.codigoOferta).toBe("3359jgv");
    expect(lido.eventoExterno).not.toBeNull();
    expect(lido.assinaturaId).not.toBeNull();
  });

  test("todo payload real traz e-mail, oferta e id — o mínimo para aplicar", () => {
    for (const [nome] of ESPERADO) {
      const lido = interpretarWebhook(carregar(nome))!;
      expect(lido.email, `${nome}: e-mail`).toContain("@");
      expect(lido.codigoOferta, `${nome}: oferta`).toBeTruthy();
      expect(lido.eventoExterno, `${nome}: id do pedido`).toBeTruthy();
      expect(lido.assinaturaId, `${nome}: id da assinatura`).toBeTruthy();
    }
  });

  test("o segredo é lido do corpo", () => {
    expect(segredoDoCorpo(carregar("purchase_approved"))).toBe("segredo-de-teste");
  });

  test("a renovação vem de subscription.next_payment_date", () => {
    const lido = interpretarWebhook(carregar("subscription_created"))!;
    expect(lido.expiraEm).toBeInstanceOf(Date);
    expect(lido.expiraEm!.toISOString().slice(0, 7)).toBe("2026-10");
  });

  test("compra aprovada sem data de renovação não inventa prazo", () => {
    // No par real, `purchase_approved` chega com `next_payment_date: null` e
    // `subscription_created` com a data. Quem aplica preserva o valor que já
    // existe quando o evento não traz um — os dois eventos descrevem a mesma
    // compra, e o que tem menos informação não pode apagar o que tem mais.
    expect(interpretarWebhook(carregar("purchase_approved"))!.expiraEm).toBeNull();
  });
});

/**
 * O achado mais perigoso dos payloads reais, isolado.
 *
 * Nos eventos ruins, o `status` do pedido continua dizendo que está tudo bem —
 * porque ele descreve o pedido que um dia foi pago, não o estado atual da
 * assinatura. Confiar nesse campo daria acesso a quem acabou de dar chargeback.
 */
describe("o status cru do pedido mente, e o evento é quem manda", () => {
  test("chargeback chega com status 'paid' e assinatura 'active'", () => {
    const corpo = carregar("chargeback") as { data: Record<string, unknown>[] };
    const pedido = corpo.data[0]!;
    expect(pedido["status"]).toBe("paid");
    expect((pedido["subscription"] as Record<string, unknown>)["status"]).toBe("active");

    // Ainda assim, bloqueia.
    const lido = interpretarWebhook(corpo)!;
    expect(lido.status).toBe("chargeback");
    expect(avaliarPlano({ status: lido.status! }).liberado).toBe(false);
  });

  test("renovação recusada também chega com status 'paid'", () => {
    const corpo = carregar("subscription_renewal_refused") as {
      data: Record<string, unknown>[];
    };
    expect(corpo.data[0]!["status"]).toBe("paid");
    expect(interpretarWebhook(corpo)!.status).toBe("atrasado");
  });

  test("pausada também chega com status 'paid' e assinatura 'active'", () => {
    const corpo = carregar("subscription_paused") as { data: Record<string, unknown>[] };
    expect(corpo.data[0]!["status"]).toBe("paid");
    expect(interpretarWebhook(corpo)!.status).toBe("pausado");
  });

  test("compra aprovada chega com a assinatura 'inactive', e libera mesmo assim", () => {
    // O campo mente nos dois sentidos: aqui ele diria para bloquear uma compra
    // que acabou de ser aprovada.
    const corpo = carregar("purchase_approved") as { data: Record<string, unknown>[] };
    const sub = corpo.data[0]!["subscription"] as Record<string, unknown>;
    expect(sub["status"]).toBe("inactive");
    expect(interpretarWebhook(corpo)!.status).toBe("ativo");
  });

  test("evento desconhecido com status 'paid' NÃO libera", () => {
    // A regra assimétrica: só o nome do evento concede acesso. O status cru
    // serve para tirar, nunca para dar — errar liberando custa o produto.
    const lido = interpretarWebhook({
      event: "evento_que_ainda_nao_existe",
      data: [{ id: "1", status: "paid", customer: { email: "x@y.com" } }],
    })!;
    expect(lido.status).toBeNull();
  });

  test("evento desconhecido com status ruim bloqueia", () => {
    const lido = interpretarWebhook({
      event: "evento_que_ainda_nao_existe",
      data: [{ id: "1", status: "refunded", customer: { email: "x@y.com" } }],
    })!;
    expect(lido.status).toBe("reembolsado");
  });
});

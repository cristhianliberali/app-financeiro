import { describe, expect, test } from "bun:test";

import {
  conferirSegredo,
  interpretarWebhook,
  normalizarNomeEvento,
  segredoDoCorpo,
} from "@/integrations/cakto/contrato";

/**
 * A tradução do webhook da Cakto.
 *
 * É a única parte da integração que dá para provar sem uma conta na Cakto, e é
 * também a que mais chances tem de estar errada: o corpo vem de fora e a
 * documentação de um gateway não é um contrato. Os testes abaixo travam dois
 * comportamentos distintos:
 *
 *   1. o corpo documentado é lido corretamente;
 *   2. um corpo *parecido, mas diferente* não vira um acesso liberado por
 *      acidente nem um evento silenciosamente perdido.
 */

/** O corpo de `purchase_approved` como a documentação da Cakto o descreve. */
const COMPRA_APROVADA = {
  secret: "segredo-do-painel",
  event: "purchase_approved",
  data: {
    id: "ord_123",
    refId: "ref_123",
    customer: {
      name: "Maria Souza",
      email: "Maria@Exemplo.com",
      phone: "+5511999999999",
      birthDate: "1990-01-01",
    },
    offer: { id: "3rkj8mp", name: "Aura Anual", price: 297 },
    offer_type: "subscription",
    product: { id: "prod_1", name: "Aura Finanças", short_id: "aura" },
    status: "paid",
    baseAmount: 297,
    discount: 0,
    amount: 297,
  },
};

describe("interpretarWebhook", () => {
  test("lê o corpo documentado de compra aprovada", () => {
    const lido = interpretarWebhook(COMPRA_APROVADA)!;

    expect(lido.evento).toBe("purchase_approved");
    expect(lido.status).toBe("ativo");
    expect(lido.eventoExterno).toBe("ord_123");
    expect(lido.codigoOferta).toBe("3rkj8mp");
    expect(lido.nomeOferta).toBe("Aura Anual");
    expect(lido.statusCakto).toBe("paid");
  });

  test("o e-mail chega normalizado, para casar com o do cadastro", () => {
    // `app_users.email` é sempre minúsculo; sem isto, "Maria@Exemplo.com" não
    // encontraria a conta de "maria@exemplo.com" e a compra ficaria órfã.
    expect(interpretarWebhook(COMPRA_APROVADA)!.email).toBe("maria@exemplo.com");
  });

  test("cada evento de assinatura leva ao seu status", () => {
    const casos = [
      ["subscription_created", "ativo"],
      ["subscription_renewed", "ativo"],
      ["subscription_canceled", "cancelado"],
      ["purchase_refused", "atrasado"],
      ["refund", "reembolsado"],
      ["chargeback", "chargeback"],
    ] as const;

    for (const [evento, esperado] of casos) {
      const lido = interpretarWebhook({ event: evento, data: { id: "x" } })!;
      expect(lido.status).toBe(esperado);
    }
  });

  test("grafia diferente do mesmo evento não muda o resultado", () => {
    // Um gateway que troca "subscription_renewed" por "subscriptionRenewed"
    // entre versões não pode virar assinante bloqueado.
    for (const grafia of [
      "subscription_renewed",
      "subscriptionRenewed",
      "subscription-renewed",
      "SUBSCRIPTION_RENEWED",
      "Assinatura Renovada",
    ]) {
      expect(interpretarWebhook({ event: grafia, data: { id: "x" } })!.status).toBe("ativo");
    }
  });

  test("campos em camelCase ou na raiz são encontrados do mesmo jeito", () => {
    const lido = interpretarWebhook({
      event: "subscription_renewed",
      data: {
        id: "ord_9",
        customerEmail: "jose@exemplo.com",
        offerId: "oferta-x",
        subscriptionId: "sub_9",
        nextPaymentDate: "2026-08-01T00:00:00Z",
      },
    })!;

    expect(lido.email).toBe("jose@exemplo.com");
    expect(lido.codigoOferta).toBe("oferta-x");
    expect(lido.assinaturaId).toBe("sub_9");
    expect(lido.expiraEm?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
  });

  test("corpo sem embrulho `data` é lido na raiz", () => {
    const lido = interpretarWebhook({
      event: "purchase_approved",
      id: "ord_7",
      customer: { email: "ana@exemplo.com" },
      offer: { id: "of_7" },
    })!;

    expect(lido.email).toBe("ana@exemplo.com");
    expect(lido.codigoOferta).toBe("of_7");
  });

  test("evento desconhecido cai no status do pedido", () => {
    // Rede de segurança: um evento novo que a Cakto passe a mandar ainda traz
    // um `status` que já conhecemos, e acertar por aí é melhor do que ignorar
    // a mudança e deixar alguém pagando sem acesso.
    const lido = interpretarWebhook({
      event: "subscription_something_new",
      data: { id: "1", status: "canceled" },
    })!;
    expect(lido.status).toBe("cancelado");
  });

  test("evento desconhecido e status desconhecido não mexem em ninguém", () => {
    // O ponto: na dúvida não se chuta. O evento fica guardado como ignorado
    // para alguém olhar, e nenhum acesso muda por adivinhação.
    const lido = interpretarWebhook({
      event: "algo_totalmente_novo",
      data: { id: "1", status: "em_analise_manual" },
    })!;
    expect(lido.status).toBeNull();
    expect(lido.evento).toBe("algo_totalmente_novo");
  });

  test("evento conhecido que não é de cobrança não altera acesso", () => {
    expect(interpretarWebhook({ event: "pix_generated", data: { id: "1" } })!.status).toBeNull();
  });

  test("corpo sem nome de evento não é interpretado", () => {
    expect(interpretarWebhook({ data: { id: "1" } })).toBeNull();
    expect(interpretarWebhook(null)).toBeNull();
    expect(interpretarWebhook("nem json de objeto")).toBeNull();
  });

  test("campos ausentes viram nulo, não string vazia nem erro", () => {
    const lido = interpretarWebhook({ event: "purchase_approved" })!;
    expect(lido.email).toBeNull();
    expect(lido.codigoOferta).toBeNull();
    expect(lido.expiraEm).toBeNull();
    expect(lido.status).toBe("ativo");
  });

  test("e-mail sem arroba é descartado", () => {
    // Melhor sem e-mail (evento fica pendente, visível no painel) do que com um
    // e-mail inválido que jamais casa com conta nenhuma.
    const lido = interpretarWebhook({
      event: "purchase_approved",
      data: { id: "1", customer: { email: "não é e-mail" } },
    })!;
    expect(lido.email).toBeNull();
  });

  test("data de renovação inválida não vira prazo", () => {
    const lido = interpretarWebhook({
      event: "subscription_renewed",
      data: { id: "1", nextPaymentDate: "amanhã" },
    })!;
    expect(lido.expiraEm).toBeNull();
  });

  test("id numérico vira texto, para servir de chave de idempotência", () => {
    expect(interpretarWebhook({ event: "refund", data: { id: 4321 } })!.eventoExterno).toBe("4321");
  });
});

describe("normalizarNomeEvento", () => {
  test("acentos, espaços e maiúsculas colapsam numa chave só", () => {
    expect(normalizarNomeEvento("Assinatura Cancelada")).toBe("assinatura_cancelada");
    expect(normalizarNomeEvento("subscriptionRenewed")).toBe("subscription_renewed");
    expect(normalizarNomeEvento("  refund  ")).toBe("refund");
  });

  test("valor que não é texto vira string vazia", () => {
    expect(normalizarNomeEvento(undefined)).toBe("");
    expect(normalizarNomeEvento(42)).toBe("");
  });
});

describe("conferirSegredo", () => {
  test("aceita o segredo exato", () => {
    expect(conferirSegredo("segredo-do-painel", "segredo-do-painel")).toBe(true);
  });

  test("recusa segredo errado, mesmo com prefixo igual", () => {
    expect(conferirSegredo("segredo-do-painel-errado", "segredo-do-painel")).toBe(false);
    expect(conferirSegredo("segredo-do-paine", "segredo-do-painel")).toBe(false);
    expect(conferirSegredo("SEGREDO-DO-PAINEL", "segredo-do-painel")).toBe(false);
  });

  test("sem segredo configurado, nada passa", () => {
    // Um endpoint que muda o acesso de qualquer pessoa não pode ficar aberto
    // enquanto ninguém terminou de configurá-lo.
    expect(conferirSegredo("qualquer-coisa", undefined)).toBe(false);
    expect(conferirSegredo("qualquer-coisa", "")).toBe(false);
  });

  test("segredo ausente ou de outro tipo não passa", () => {
    expect(conferirSegredo(undefined, "segredo")).toBe(false);
    expect(conferirSegredo("", "segredo")).toBe(false);
    expect(conferirSegredo({ secret: "segredo" }, "segredo")).toBe(false);
  });
});

describe("segredoDoCorpo", () => {
  test("acha o segredo do corpo documentado", () => {
    expect(segredoDoCorpo(COMPRA_APROVADA)).toBe("segredo-do-painel");
  });

  test("acha também quando vem dentro de data", () => {
    expect(segredoDoCorpo({ data: { secret: "s2" } })).toBe("s2");
  });

  test("corpo sem segredo devolve nulo", () => {
    expect(segredoDoCorpo({ event: "refund" })).toBeNull();
  });
});

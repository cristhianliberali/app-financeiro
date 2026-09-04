import { describe, expect, test } from "bun:test";

import { avaliarPlano, planoLiberado, normalizarStatus, STATUS_PLANO } from "@/lib/plano";

/**
 * A regra que decide quem entra no app.
 *
 * É a função mais barata de escrever errado e a mais cara de errar: um falso
 * "liberado" entrega o produto de graça, e um falso "bloqueado" tranca quem
 * pagou para fora dos próprios dados. Os dois lados estão travados aqui.
 */

const AGORA = new Date("2026-06-15T12:00:00Z");

describe("avaliarPlano", () => {
  test("ativo sem prazo entra", () => {
    expect(avaliarPlano({ status: "ativo" }, { agora: AGORA }).liberado).toBe(true);
  });

  test("cortesia e trial também entram", () => {
    expect(planoLiberado({ status: "cortesia" }, { agora: AGORA })).toBe(true);
    expect(planoLiberado({ status: "trial" }, { agora: AGORA })).toBe(true);
  });

  test("cancelado, reembolsado e chargeback não entram", () => {
    for (const status of ["cancelado", "reembolsado", "chargeback"] as const) {
      const avaliacao = avaliarPlano({ status }, { agora: AGORA });
      expect(avaliacao.liberado).toBe(false);
      expect(avaliacao.motivo).toBe("encerrado");
    }
  });

  test("quem nunca assinou tem o motivo próprio, não o de encerrado", () => {
    // A diferença importa na tela: um precisa de um botão de compra, o outro de
    // uma explicação sobre o que aconteceu com a assinatura que existia.
    expect(avaliarPlano({ status: "sem_assinatura" }, { agora: AGORA }).motivo).toBe(
      "sem_assinatura",
    );
  });

  test("assinatura pausada bloqueia, com motivo próprio", () => {
    // `pausado` existe porque a Cakto manda `subscription_paused` de verdade.
    // Pausa não é inadimplência (ninguém deixou de pagar) nem cancelamento
    // (a assinatura volta), e a frase que a pessoa lê muda em cada caso.
    const avaliacao = avaliarPlano({ status: "pausado" }, { agora: AGORA });
    expect(avaliacao.liberado).toBe(false);
    expect(avaliacao.motivo).toBe("pausado");
  });

  describe("inadimplência tem carência, porque a Cakto tenta de novo", () => {
    // Os webhooks reais trazem `max_retries: 3` e `retry_interval: 1`: três
    // tentativas, uma por dia. Cortar o acesso na primeira recusa tiraria o app
    // de quem vai pagar amanhã.
    const recusadoAgora = { status: "atrasado", atualizadoEm: AGORA } as const;

    test("no dia da recusa, continua entrando", () => {
      expect(planoLiberado(recusadoAgora, { agora: AGORA, diasCarencia: 3 })).toBe(true);
    });

    test("no segundo dia ainda entra", () => {
      const doisDias = new Date(AGORA.getTime() + 2 * 864e5);
      expect(planoLiberado(recusadoAgora, { agora: doisDias, diasCarencia: 3 })).toBe(true);
    });

    test("esgotadas as tentativas, bloqueia", () => {
      const quatroDias = new Date(AGORA.getTime() + 4 * 864e5);
      const avaliacao = avaliarPlano(recusadoAgora, { agora: quatroDias, diasCarencia: 3 });
      expect(avaliacao.liberado).toBe(false);
      expect(avaliacao.motivo).toBe("inadimplente");
    });

    test("com carência zero, bloqueia na hora", () => {
      expect(planoLiberado(recusadoAgora, { agora: AGORA, diasCarencia: 0 })).toBe(false);
    });

    test("sem saber quando a recusa chegou, não se estende carência nenhuma", () => {
      // Data ausente ou corrompida não pode virar acesso indefinido: a carência
      // é uma janela, e sem o começo dela não há janela.
      expect(planoLiberado({ status: "atrasado" }, { agora: AGORA, diasCarencia: 3 })).toBe(false);
      expect(
        planoLiberado(
          { status: "atrasado", atualizadoEm: "não é data" },
          { agora: AGORA, diasCarencia: 3 },
        ),
      ).toBe(false);
    });

    test("prazo pago futuro não substitui a carência", () => {
      // Nos eventos de recusa, `next_payment_date` aponta a próxima *tentativa*,
      // não uma data até a qual a pessoa pagou. Se `expiraEm` mandasse aqui, uma
      // recusa daria um mês de acesso de graça.
      const seteDias = new Date(AGORA.getTime() + 7 * 864e5);
      expect(
        planoLiberado(
          {
            status: "atrasado",
            atualizadoEm: AGORA,
            expiraEm: new Date(AGORA.getTime() + 30 * 864e5),
          },
          { agora: seteDias, diasCarencia: 3 },
        ),
      ).toBe(false);
    });
  });

  describe("prazo e tolerância", () => {
    test("ativo com prazo no futuro entra", () => {
      expect(
        planoLiberado({ status: "ativo", expiraEm: "2026-07-01T00:00:00Z" }, { agora: AGORA }),
      ).toBe(true);
    });

    test("sem tolerância, o prazo vencido bloqueia", () => {
      const avaliacao = avaliarPlano(
        { status: "ativo", expiraEm: "2026-06-14T00:00:00Z" },
        { agora: AGORA },
      );
      expect(avaliacao.liberado).toBe(false);
      expect(avaliacao.motivo).toBe("vencido");
    });

    test("dentro da tolerância, quem venceu ontem continua entrando", () => {
      // É o caso real de todo ciclo de cobrança: a renovação acontece na Cakto
      // e o webhook chega minutos depois. Sem esta folga, todo assinante em dia
      // perderia o app nesse intervalo.
      expect(
        planoLiberado(
          { status: "ativo", expiraEm: "2026-06-14T00:00:00Z" },
          { agora: AGORA, toleranciaDias: 3 },
        ),
      ).toBe(true);
    });

    test("passada a tolerância, bloqueia mesmo assim", () => {
      expect(
        planoLiberado(
          { status: "ativo", expiraEm: "2026-06-10T00:00:00Z" },
          { agora: AGORA, toleranciaDias: 3 },
        ),
      ).toBe(false);
    });

    test("cortesia sem prazo não vence nunca", () => {
      const daquiADezAnos = new Date("2036-06-15T12:00:00Z");
      expect(planoLiberado({ status: "cortesia", expiraEm: null }, { agora: daquiADezAnos })).toBe(
        true,
      );
    });

    test("prazo não ressuscita status encerrado", () => {
      // Cancelar e ainda ter data futura acontece (cancelamento no meio do
      // ciclo). Quem decide é o status; a data só encurta, nunca libera.
      expect(
        planoLiberado({ status: "cancelado", expiraEm: "2026-12-01T00:00:00Z" }, { agora: AGORA }),
      ).toBe(false);
    });
  });

  test("data inválida é tratada como ausência de prazo, não como vencida", () => {
    // Um `expiraEm` corrompido não pode virar bloqueio de quem pagou.
    expect(planoLiberado({ status: "ativo", expiraEm: "não é data" }, { agora: AGORA })).toBe(true);
  });

  test("diasRestantes conta o que falta, e fica nulo sem prazo", () => {
    expect(
      avaliarPlano({ status: "ativo", expiraEm: "2026-06-20T12:00:00Z" }, { agora: AGORA })
        .diasRestantes,
    ).toBe(5);
    expect(avaliarPlano({ status: "ativo" }, { agora: AGORA }).diasRestantes).toBeNull();
  });
});

describe("normalizarStatus", () => {
  test("todo status do vocabulário passa inteiro", () => {
    for (const status of STATUS_PLANO) expect(normalizarStatus(status)).toBe(status);
  });

  test("lixo vira sem_assinatura, e não um acesso liberado", () => {
    // O padrão de um valor desconhecido tem que ser o mais restritivo: um
    // status estranho no banco não pode abrir o app.
    for (const lixo of [null, undefined, "", "ATIVO", "vip", 42, {}]) {
      expect(normalizarStatus(lixo)).toBe("sem_assinatura");
      expect(planoLiberado({ status: normalizarStatus(lixo) })).toBe(false);
    }
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { ehEventoDeProvisionamento, interpretarWebhook } from "@/integrations/cakto/contrato";
import { gerarSenhaProvisoria } from "@/integrations/postgres/password.server";

/**
 * Quem dispara a criação da conta, e que senha ela recebe.
 *
 * O teste que importa aqui é o de exclusão: uma compra manda `purchase_approved`
 * *e* `subscription_created`, e provisionar nos dois criaria a conta uma vez e
 * mandaria duas senhas diferentes para a mesma pessoa.
 */

function carregar(nome: string): unknown {
  return JSON.parse(readFileSync(`test/fixtures/cakto/${nome}.json`, "utf8"));
}

describe("qual evento entrega o acesso", () => {
  test("só a assinatura criada provisiona", () => {
    expect(ehEventoDeProvisionamento("subscription_created")).toBe(true);
  });

  test("nenhum outro evento real provisiona", () => {
    for (const evento of [
      "purchase_approved",
      "subscription_renewed",
      "subscription_resumed",
      "subscription_renewal_refused",
      "subscription_paused",
      "subscription_canceled",
      "refund",
      "chargeback",
    ]) {
      expect(ehEventoDeProvisionamento(evento), evento).toBe(false);
    }
  });

  test("a renovação nunca provisiona — senão a senha trocaria a cada ciclo", () => {
    // Quem renova já tem conta há um mês e já escolheu a própria senha.
    expect(ehEventoDeProvisionamento("subscription_renewed")).toBe(false);
    expect(ehEventoDeProvisionamento("subscription_renewal")).toBe(false);
  });

  test("a grafia do evento não muda a decisão", () => {
    for (const grafia of ["subscriptionCreated", "SUBSCRIPTION_CREATED", "Assinatura Criada"]) {
      expect(ehEventoDeProvisionamento(grafia), grafia).toBe(true);
    }
  });

  test("os dois eventos da MESMA compra, e só um provisiona", () => {
    // A prova de que a exclusão importa: nas fixtures reais, `purchase_approved`
    // e `subscription_created` carregam o mesmo pedido. Sem a restrição, seriam
    // dois e-mails com senhas diferentes para a mesma compra.
    const compra = interpretarWebhook(carregar("purchase_approved"))!;
    const assinatura = interpretarWebhook(carregar("subscription_created"))!;

    expect(compra.eventoExterno).toBe(assinatura.eventoExterno!);
    expect(compra.email).toBe(assinatura.email!);

    expect(ehEventoDeProvisionamento(compra.evento)).toBe(false);
    expect(ehEventoDeProvisionamento(assinatura.evento)).toBe(true);
  });
});

describe("gerarSenhaProvisoria", () => {
  test("tem o formato de três blocos de quatro", () => {
    expect(gerarSenhaProvisoria()).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
  });

  test("passa no mínimo de senha que o app exige", () => {
    // Se um dia MIN_PASSWORD subir acima de 14, a senha gerada precisa
    // acompanhar — senão o app recusaria a própria credencial que enviou.
    expect(gerarSenhaProvisoria().length).toBeGreaterThanOrEqual(8);
  });

  test("não usa caracteres ambíguos", () => {
    // Quem recebe digita isto de um e-mail. `0`/`O` e `1`/`l`/`I` viram um
    // "não consigo entrar" que o suporte não consegue diagnosticar.
    const juntas = Array.from({ length: 300 }, gerarSenhaProvisoria).join("");
    for (const proibido of ["0", "O", "1", "l", "I", "5", "S", "2", "Z"]) {
      expect(juntas.includes(proibido), `contém "${proibido}"`).toBe(false);
    }
  });

  test("não se repete", () => {
    const geradas = new Set(Array.from({ length: 500 }, gerarSenhaProvisoria));
    expect(geradas.size).toBe(500);
  });
});

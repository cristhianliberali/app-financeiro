import { describe, expect, test } from "bun:test";

import type { Categoria } from "@/integrations/ai/pipeline/classify.server";
import { cacheEmMemoria } from "@/integrations/ai/pipeline/merchants.server";
import { processar } from "@/integrations/ai/pipeline/pipeline.server";
import type { LlmClient } from "@/integrations/ai/pipeline/provider.server";
import {
  confirmar,
  DocumentoNaoConfirmadoError,
  EstadoDocumento,
  MotivoQuarentena,
  paraPersistir,
  rotulosConfirmados,
  transicionar,
  TransicaoInvalidaError,
  type ResultadoQuarentena,
} from "@/integrations/ai/pipeline/quarantine";

const HOJE = new Date("2026-02-20T12:00:00Z");

const CATEGORIAS: Categoria[] = [
  { codigo: "GAS", nome: "Alimentação", descricao: "mercado, padaria, restaurante" },
  { codigo: "SRV", nome: "Serviços", descricao: "assinaturas" },
  { codigo: "TUR", nome: "Viagem", descricao: null },
];

/**
 * Cliente falso da camada 3, com o comportamento mínimo de um modelo que
 * acerta: linha terminada em valor é lançamento, o resto é ruído. `confianca` e
 * `desviar` deixam o teste montar a situação que quer, sem modelo nenhum.
 */
function clienteFalso(
  opcoes: { confianca?: number; desviar?: (id: number, texto: string) => string | null } = {},
): LlmClient {
  const confianca = opcoes.confianca ?? 0.95;
  return {
    nome: "falso",
    async completar(pedido) {
      return [...pedido.usuario.matchAll(/^(\d+): (.*)$/gm)]
        .map(([, idBruto, texto = ""]) => {
          const id = Number(idBruto);
          const desvio = opcoes.desviar?.(id, texto);
          if (desvio) return desvio;
          return /\d[.,]\d{2}\s*$/.test(texto)
            ? `${id}:L,GAS,${confianca}`
            : `${id}:R,-,${confianca}`;
        })
        .join("\n");
    },
  };
}

const fixture = () => Bun.file("test/fixtures/fatura-sicoob.txt").text();

async function rodar(texto: string, cliente: LlmClient = clienteFalso()) {
  return processar({
    arquivo: { nome: "fatura.txt", bytes: new TextEncoder().encode(texto) },
    categorias: CATEGORIAS,
    cliente,
    hoje: HOJE,
  });
}

/** A fixture inteira, mas com toda decisão abaixo do limiar de confiança. */
async function emQuarentena(): Promise<ResultadoQuarentena> {
  const { quarentena } = await rodar(await fixture(), clienteFalso({ confianca: 0.5 }));
  return quarentena;
}

const semVipi = async () =>
  (await fixture())
    .split("\n")
    .filter((linha) => !linha.includes("VIPI SUPERMERCADOS"))
    .join("\n");

describe("camada 5 — máquina de estados", () => {
  test("o caminho feliz e o desvio pela quarentena", () => {
    expect(transicionar(EstadoDocumento.RECEBIDO, EstadoDocumento.CANONIZADO)).toBe("canonizado");
    expect(transicionar(EstadoDocumento.RECONCILIADO, EstadoDocumento.CONFIRMADO)).toBe(
      "confirmado",
    );
    expect(transicionar(EstadoDocumento.RECONCILIADO, EstadoDocumento.QUARENTENA)).toBe(
      "quarentena",
    );
    expect(transicionar(EstadoDocumento.QUARENTENA, EstadoDocumento.CONFIRMADO)).toBe("confirmado");
  });

  test("pular etapa é erro, não atalho", () => {
    expect(() => transicionar(EstadoDocumento.RECEBIDO, EstadoDocumento.CONFIRMADO)).toThrow(
      TransicaoInvalidaError,
    );
    expect(() => transicionar(EstadoDocumento.CONFIRMADO, EstadoDocumento.QUARENTENA)).toThrow(
      TransicaoInvalidaError,
    );
  });
});

describe("camada 5 — quarentena", () => {
  test("a fixture dourada passa inteira, sem nada em revisão", async () => {
    const { quarentena, reconciliacao } = await rodar(await fixture());

    expect(reconciliacao.fechouTudo).toBe(true);
    expect(quarentena.estado).toBe(EstadoDocumento.CONFIRMADO);
    expect(quarentena.emRevisao).toEqual([]);
    expect(quarentena.prontos).toHaveLength(17);

    const airbnb = quarentena.prontos.find((linha) => linha.descricao.startsWith("AIRBNB"))!;
    expect(airbnb).toMatchObject({
      valor: 1240.5,
      dataIso: "2025-06-08",
      dataRaw: "08 JUN",
      categoria: "GAS",
      parcela: { numero: 5, total: 6 },
    });

    const estorno = quarentena.prontos.find((linha) => linha.valor < 0)!;
    expect(estorno).toMatchObject({ valor: -29.9, estorno: true });
  });

  test("confiança abaixo do limiar manda a linha para revisão", async () => {
    const quarentena = await emQuarentena();

    expect(quarentena.estado).toBe(EstadoDocumento.QUARENTENA);
    expect(quarentena.prontos).toEqual([]);

    const comProposta = quarentena.emRevisao.filter((item) => item.proposta !== null);
    expect(comProposta).toHaveLength(17);
    expect(comProposta[0]!.motivos).toEqual([MotivoQuarentena.CONFIANCA_BAIXA]);

    // As linhas que a camada 2 não resolveu entram com o motivo delas.
    const ambiguas = quarentena.emRevisao.filter((item) =>
      item.motivos.includes(MotivoQuarentena.AMBIGUA_NAO_RESOLVIDA),
    );
    expect(ambiguas).toHaveLength(5);
  });

  test("reconciliação aberta segura o documento inteiro", async () => {
    const { quarentena } = await rodar(await semVipi());

    expect(quarentena.estado).toBe(EstadoDocumento.QUARENTENA);
    expect(quarentena.motivosDoDocumento).toContain(MotivoQuarentena.RECONCILIACAO_ABERTA);

    const motivos = quarentena.emRevisao.flatMap((item) => item.motivos);
    expect(motivos).toContain(MotivoQuarentena.RECONCILIACAO_ABERTA);
    expect(motivos).toContain(MotivoQuarentena.LANCAMENTO_ORFAO);
  });

  test("o modelo dizer lançamento não cria valor onde o parser não achou", async () => {
    const texto = ["Vencimento: 10/02/2026", "Titular: FULANO DE TAL"].join("\n");
    // O modelo insiste que a linha do titular é lançamento; ela não tem valor.
    const cliente = clienteFalso({
      desviar: (id, linha) => (linha.includes("Titular") ? `${id}:L,GAS,0.99` : null),
    });
    const { tipado, quarentena } = await rodar(texto, cliente);

    const ambigua = tipado.linhas.find((linha) => linha.texto.includes("Titular"))!;
    const item = quarentena.emRevisao.find((revisao) => revisao.linhaId === ambigua.id)!;

    expect(item.motivos).toContain(MotivoQuarentena.SEM_VALOR_DETERMINISTICO);
    expect(item.proposta).toBeNull();
    expect(quarentena.prontos).toEqual([]);
  });

  test("o item de revisão traz o trecho cru e a âncora no documento", async () => {
    const quarentena = await emQuarentena();
    const item = quarentena.emRevisao.find((revisao) => revisao.texto.includes("VIPI"))!;

    expect(item.texto).toContain("VIPI SUPERMERCADOS E");
    expect(item.texto).toContain("251.65");
    // Texto colado não tem geometria; num PDF a âncora traz o bbox da linha.
    expect(item.ancora).toEqual({ pagina: 1, bbox: null });
    expect(item.proposta).toMatchObject({ descricao: "VIPI SUPERMERCADOS E", valor: 251.65 });
  });
});

describe("camada 5 — nada entra no banco antes de confirmado", () => {
  test("persistir um documento em quarentena levanta erro", async () => {
    const quarentena = await emQuarentena();
    expect(() => paraPersistir(quarentena)).toThrow(DocumentoNaoConfirmadoError);
  });

  test("item sem revisão mantém o documento onde está", async () => {
    const quarentena = await emQuarentena();
    const metade = quarentena.emRevisao
      .slice(0, 3)
      .map((item) => ({ linhaId: item.linhaId, aceitar: true }));

    const depois = confirmar(quarentena, metade);
    expect(depois.estado).toBe(EstadoDocumento.QUARENTENA);
    expect(depois.emRevisao).toHaveLength(quarentena.emRevisao.length);
    expect(() => paraPersistir(depois)).toThrow(DocumentoNaoConfirmadoError);
  });

  test("revisar tudo confirma, e a correção do usuário vale mais que o modelo", async () => {
    const quarentena = await emQuarentena();
    const corrigida = quarentena.emRevisao.find((item) => item.proposta !== null)!;
    const revisoes = quarentena.emRevisao.map((item) => ({
      linhaId: item.linhaId,
      aceitar: true,
      ...(item.linhaId === corrigida.linhaId ? { categoria: "TUR" } : {}),
    }));

    const confirmado = confirmar(quarentena, revisoes);
    expect(confirmado.estado).toBe(EstadoDocumento.CONFIRMADO);

    const lancamentos = paraPersistir(confirmado);
    expect(lancamentos).toHaveLength(17);
    expect(lancamentos.find((linha) => linha.linhaId === corrigida.linhaId)).toMatchObject({
      categoria: "TUR",
      confianca: 1,
    });
  });

  test("linha recusada na revisão não vira lançamento", async () => {
    const quarentena = await emQuarentena();
    const recusada = quarentena.emRevisao.find((item) => item.proposta !== null)!;
    const revisoes = quarentena.emRevisao.map((item) => ({
      linhaId: item.linhaId,
      aceitar: item.linhaId !== recusada.linhaId,
    }));

    const lancamentos = paraPersistir(confirmar(quarentena, revisoes));
    expect(lancamentos).toHaveLength(16);
    expect(lancamentos.some((linha) => linha.linhaId === recusada.linhaId)).toBe(false);
  });

  test("pendência do documento precisa ser aceita explicitamente", async () => {
    const { quarentena } = await rodar(await semVipi());
    const revisoes = quarentena.emRevisao.map((item) => ({
      linhaId: item.linhaId,
      aceitar: item.proposta !== null,
    }));

    expect(confirmar(quarentena, revisoes).estado).toBe(EstadoDocumento.QUARENTENA);
    expect(confirmar(quarentena, revisoes, { aceitarPendenciasDoDocumento: true }).estado).toBe(
      EstadoDocumento.CONFIRMADO,
    );
  });

  test("cada confirmação vira rótulo para o cache de merchants", async () => {
    const { quarentena } = await rodar(await fixture());
    const rotulos = rotulosConfirmados(quarentena);

    expect(rotulos).toHaveLength(17);
    expect(rotulos).toContainEqual({ descritor: "VIPI SUPERMERCADOS E", categoria: "GAS" });
  });
});

describe("pipeline completo", () => {
  test("o cache aprendido numa importação poupa a chamada na seguinte", async () => {
    const cache = cacheEmMemoria();
    const base = clienteFalso();
    let chamadas = 0;
    const cliente: LlmClient = {
      nome: "contador",
      completar(pedido) {
        chamadas += 1;
        return base.completar(pedido);
      },
    };

    const arquivo = { nome: "fatura.txt", bytes: new TextEncoder().encode(await fixture()) };
    const comum = { arquivo, categorias: CATEGORIAS, cliente, cache, hoje: HOJE };

    const primeira = await processar(comum);
    const chamadasDaPrimeira = chamadas;
    const segunda = await processar(comum);

    expect(primeira.classificacao.doCache).toBe(0);
    expect(chamadasDaPrimeira).toBeGreaterThan(0);
    // Os 17 lançamentos já têm rótulo; sobram as ambíguas, num bloco só.
    expect(chamadas - chamadasDaPrimeira).toBe(1);
    expect(segunda.classificacao.doCache).toBe(17);
    expect(segunda.quarentena.estado).toBe(EstadoDocumento.CONFIRMADO);
  });
});

import { beforeEach, describe, expect, test } from "bun:test";

import { validarMidia } from "@/integrations/ai/chat/midia.server";

/**
 * A portaria dos anexos.
 *
 * Todo caso aqui é um arquivo que chegaria ao provedor e voltaria como erro
 * genérico depois de uma espera — ou, no caso do `video/webm`, uma gravação
 * feita pelo próprio app que seria recusada por causa do rótulo que o navegador
 * escolheu.
 */
/** Base64 de ~2 MB — folgado dos dois lados do teto testado, para não medir a borda. */
const base64De2Mb = "A".repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3));

beforeEach(() => {
  process.env["GROQ_API_KEY"] = "chave-de-teste";
});

describe("validarMidia", () => {
  test("aceita os formatos de imagem que o provedor lê", () => {
    for (const mime of ["image/jpeg", "image/png", "image/webp", "image/gif"]) {
      expect(() => validarMidia({ mime, base64: "QUJD" }, "imagem", 4)).not.toThrow();
    }
  });

  test("recusa formato de imagem que o provedor não lê, dizendo quais servem", () => {
    expect(() => validarMidia({ mime: "image/heic", base64: "QUJD" }, "imagem", 4)).toThrow(
      /JPG, PNG ou WEBP/,
    );
    expect(() => validarMidia({ mime: "application/pdf", base64: "QUJD" }, "imagem", 4)).toThrow(
      /não aceito/,
    );
  });

  test("o `;codecs=opus` do navegador não muda o formato", () => {
    expect(() =>
      validarMidia({ mime: "audio/webm;codecs=opus", base64: "QUJD" }, "audio", 15),
    ).not.toThrow();
  });

  test("aceita o `video/webm` com que alguns navegadores rotulam áudio puro", () => {
    // Recusá-lo seria recusar a gravação feita pelo próprio app.
    expect(() => validarMidia({ mime: "video/webm", base64: "QUJD" }, "audio", 15)).not.toThrow();
    // O mp4 do Safari é o outro caso real.
    expect(() => validarMidia({ mime: "audio/mp4", base64: "QUJD" }, "audio", 15)).not.toThrow();
  });

  test("recusa acima do teto configurado, antes de subir o arquivo", () => {
    expect(() =>
      validarMidia({ mime: "image/jpeg", base64: base64De2Mb }, "imagem", 4),
    ).not.toThrow();
    expect(() => validarMidia({ mime: "image/jpeg", base64: base64De2Mb }, "imagem", 1)).toThrow(
      /passa de 1 MB/,
    );
    expect(() => validarMidia({ mime: "audio/webm", base64: base64De2Mb }, "audio", 1)).toThrow(
      /trecho mais curto/,
    );
  });

  test("arquivo vazio é dito como vazio, e não como formato errado", () => {
    expect(() => validarMidia({ mime: "image/jpeg", base64: "" }, "imagem", 4)).toThrow(/vazia/);
    expect(() => validarMidia({ mime: "audio/webm", base64: "" }, "audio", 15)).toThrow(/vazio/);
  });
});

/**
 * Preparo dos anexos do chat, no navegador.
 *
 * Roda só no cliente: usa `FileReader`, `createImageBitmap` e `canvas`. O que
 * sai daqui é o mesmo formato que a importação de faturas já usa — nome, tipo e
 * base64 —, então o transporte até o servidor não inventa nada novo.
 */
import type { MidiaChat } from "./chat.functions";

/** Maior lado da imagem enviada, em pixels. */
const LADO_MAXIMO = 1600;
/** Qualidade do JPEG gerado na redução. */
const QUALIDADE = 0.85;

/** O `data:` URL do FileReader sem o cabeçalho — só o base64. */
function semPrefixo(dataUrl: string): string {
  const virgula = dataUrl.indexOf(",");
  return virgula >= 0 ? dataUrl.slice(virgula + 1) : dataUrl;
}

export function arquivoParaBase64(arquivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onload = () => resolve(semPrefixo(String(leitor.result ?? "")));
    leitor.onerror = () => reject(new Error("Não consegui ler o arquivo"));
    leitor.readAsDataURL(arquivo);
  });
}

/**
 * Reduz a foto antes de enviar.
 *
 * Uma foto de celular tem 4 a 12 MB e uns 4000 px de largura. O provedor recusa
 * base64 acima de ~4 MB, e mesmo abaixo disso a imagem cheia só custa tempo de
 * upload: o que decide se um cupom é legível é a nitidez do texto, e 1600 px no
 * maior lado já resolvem qualquer cupom fotografado de perto.
 *
 * Se o navegador não souber decodificar o arquivo (HEIC de iPhone em navegador
 * que não seja o Safari, por exemplo), o original segue como está — aí quem
 * recusa é o servidor, com uma mensagem dizendo os formatos aceitos.
 */
export async function prepararImagem(arquivo: File): Promise<MidiaChat> {
  const nome = arquivo.name || "imagem.jpg";

  try {
    const bitmap = await createImageBitmap(arquivo);
    const escala = Math.min(1, LADO_MAXIMO / Math.max(bitmap.width, bitmap.height));

    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * escala);
    canvas.height = Math.round(bitmap.height * escala);

    const contexto = canvas.getContext("2d");
    if (!contexto) throw new Error("sem canvas 2d");
    contexto.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", QUALIDADE),
    );
    if (!blob) throw new Error("não consegui converter a imagem");

    return {
      nome: nome.replace(/\.[^.]+$/, "") + ".jpg",
      mime: "image/jpeg",
      base64: await arquivoParaBase64(blob),
    };
  } catch {
    return {
      nome,
      mime: arquivo.type || "image/jpeg",
      base64: await arquivoParaBase64(arquivo),
    };
  }
}

/** `95` -> `1:35`. */
export function formatarDuracao(segundos: number): string {
  const minutos = Math.floor(segundos / 60);
  return `${minutos}:${String(Math.floor(segundos % 60)).padStart(2, "0")}`;
}

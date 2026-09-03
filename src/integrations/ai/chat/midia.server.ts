/**
 * Portaria dos anexos do chat.
 *
 * Confere formato e tamanho antes de gastar uma requisição. O teto existe dos
 * dois lados: a Groq recusa base64 de imagem acima de ~4 MB, e um arquivo
 * grande demais que só falha lá vira uma espera longa terminada em erro
 * genérico. Aqui a recusa é imediata e diz o que fazer.
 *
 * Fica separado do orquestrador porque é regra de dado, não de conversa — e
 * porque assim dá para testá-la sem subir banco nem provedor.
 */
import { ChatProviderError } from "./groq.server";

/** Tipos que o provedor aceita em cada canal — o resto é recusado antes de subir. */
const MIMES_IMAGEM = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MIMES_AUDIO = [
  "audio/webm",
  "audio/ogg",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/x-m4a",
  "audio/wav",
  "audio/x-wav",
  "audio/flac",
  // O MediaRecorder de alguns navegadores rotula a gravação só de áudio como
  // `video/webm`. É o mesmo contêiner, e recusá-la seria recusar a gravação
  // feita pelo próprio app.
  "video/webm",
];

export function validarMidia(
  midia: { mime: string; base64: string },
  canal: "imagem" | "audio",
  maxMb: number,
): void {
  const aceitos = canal === "imagem" ? MIMES_IMAGEM : MIMES_AUDIO;
  // O `;codecs=opus` que o navegador acrescenta não muda o formato.
  const mime = midia.mime.split(";")[0]!.trim().toLowerCase();
  if (!aceitos.includes(mime)) {
    throw new ChatProviderError(
      canal === "imagem"
        ? `Formato de imagem não aceito (${mime || "desconhecido"}). Use JPG, PNG ou WEBP.`
        : `Formato de áudio não aceito (${mime || "desconhecido"}).`,
    );
  }

  const bytes = Math.floor((midia.base64.length * 3) / 4);
  if (bytes > maxMb * 1024 * 1024) {
    throw new ChatProviderError(
      canal === "imagem"
        ? `A imagem passa de ${maxMb} MB. Envie uma foto menor ou um recorte.`
        : `O áudio passa de ${maxMb} MB. Grave um trecho mais curto.`,
    );
  }
  if (bytes === 0) {
    throw new ChatProviderError(
      canal === "imagem" ? "A imagem chegou vazia." : "O áudio chegou vazio.",
    );
  }
}

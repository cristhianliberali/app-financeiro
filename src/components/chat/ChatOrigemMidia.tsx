import { useState } from "react";
import { ChevronDown, Mic, ScanText } from "lucide-react";

import type { OrigemMidia } from "@/lib/chat-contract";

/**
 * O log do que foi extraído de uma imagem ou de um áudio.
 *
 * Fica discreto de propósito: uma linha pequena e apagada, que só vira texto
 * inteiro quando alguém clica. Quem fotografou o cupom quer ver o lançamento,
 * não a transcrição — mas quando o lançamento sair estranho, esta linha é a
 * única forma de saber em qual etapa corrigir: se o papel foi lido errado, ou
 * se foi o pedido que foi entendido errado.
 *
 * É também o que impede a leitura da imagem de ser uma caixa-preta. O valor de
 * um comprovante passa por um modelo antes de virar rascunho; mostrar o texto
 * lido é o que torna esse passo conferível.
 */
export function ChatOrigemMidia({ origem }: { origem: OrigemMidia }) {
  const [aberto, setAberto] = useState(false);
  const Icone = origem.tipo === "imagem" ? ScanText : Mic;
  const rotulo = origem.tipo === "imagem" ? "Lido da imagem" : "Transcrito do áudio";

  // Uma linha só, para caber no rodapé da mensagem sem competir com ela.
  const previa = origem.extraido.replace(/\s+/g, " ").trim();

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex w-full items-center gap-1.5 text-left text-[11px] text-muted-foreground transition-colors hover:text-foreground"
      >
        <Icone className="size-3 shrink-0" />
        <span className="shrink-0 font-medium">{rotulo}</span>
        {!aberto && <span className="min-w-0 flex-1 truncate opacity-70">{previa}</span>}
        <ChevronDown
          className={`size-3 shrink-0 transition-transform ${aberto ? "rotate-180" : ""}`}
        />
      </button>

      {aberto && (
        <div className="mt-1.5 rounded-lg border border-border bg-muted/40 p-2">
          <pre className="whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-muted-foreground">
            {origem.extraido}
          </pre>
          <p className="mt-1.5 text-[10px] text-muted-foreground/70">
            Extraído por {origem.modelo}. Confira os valores antes de confirmar.
          </p>
        </div>
      )}
    </div>
  );
}

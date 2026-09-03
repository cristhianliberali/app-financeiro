import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bot,
  CornerDownLeft,
  ImagePlus,
  Mic,
  Sparkles,
  Square,
  Trash2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAudioRecorder } from "@/hooks/use-audio-recorder";
import { useAppState } from "@/lib/app-state";
import { useCategories } from "@/lib/data";
import { arquivoParaBase64, formatarDuracao, prepararImagem } from "@/lib/chat-midia";
import {
  useChatConfig,
  useChatMessage,
  useConfirmarRascunho,
  type ChatReply,
  type HistoricoChat,
  type MidiaChat,
  type OrigemMidia,
  type RascunhoLancamento,
} from "@/lib/chat";
import { MAX_MENSAGEM_CHAT } from "@/lib/chat.functions";

import { ChatConsultaCard } from "./ChatConsultaCard";
import { ChatDraftCard } from "./ChatDraftCard";
import { ChatOrigemMidia } from "./ChatOrigemMidia";

/**
 * O assistente de IA do Finanças.
 *
 * A conversa vive só nesta tela: nada é guardado em banco, e fechar a gaveta
 * mantém o que já foi dito enquanto a página não recarrega. É de propósito —
 * o valor do recurso está no que ele registra e responde, não num histórico de
 * conversa que ninguém volta a ler.
 *
 * São três formas de dizer a mesma coisa: escrever, fotografar o comprovante ou
 * falar. As três desembocam no mesmo lugar — a imagem e o áudio viram texto no
 * servidor, e daí em diante o caminho é idêntico ao de uma frase digitada.
 *
 * O ciclo é sempre o mesmo: a pessoa manda, a IA interpreta, e o que volta é ou
 * uma resposta com números vindos do banco, ou um rascunho para revisar. A IA
 * nunca grava nada; quem grava é o botão "Confirmar" do rascunho.
 */

/** O anexo pendente, já preparado, esperando o envio. */
type Anexo = {
  tipo: "imagem" | "audio";
  midia: MidiaChat;
  /** `objectURL` da miniatura, só para a imagem. */
  preview?: string;
  segundos?: number;
};

type ItemChat = {
  id: string;
  role: "user" | "assistant";
  texto: string;
  reply?: ChatReply;
  /** Rascunho em edição — parte do item, para cada proposta ter o seu. */
  rascunho?: RascunhoLancamento;
  /** Quantos lançamentos este rascunho gerou depois de confirmado. */
  confirmado?: number;
  /** O que foi lido da imagem ou do áudio, mostrado discretamente. */
  origem?: OrigemMidia;
  /** Miniatura da imagem que a pessoa enviou. */
  imagemPreview?: string;
  erro?: boolean;
};

const EXEMPLOS = [
  "Quanto gastei este mês em alimentação?",
  "Gastei 158 no mercado",
  "Qual foi meu saldo no mês passado?",
  "Paguei 1.200 de aluguel ontem",
];

export function AiChatSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { profileId } = useAppState();
  const { data: categories } = useCategories(profileId);
  const enviar = useChatMessage();
  const confirmar = useConfirmarRascunho();
  const gravacao = useAudioRecorder();

  const [itens, setItens] = useState<ItemChat[]>([]);
  const [texto, setTexto] = useState("");
  const [anexo, setAnexo] = useState<Anexo | null>(null);
  const [preparando, setPreparando] = useState(false);
  /** Qual rascunho está sendo gravado — com dois na tela, só um mostra "Registrando…". */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);

  const fim = useRef<HTMLDivElement>(null);
  const seletorImagem = useRef<HTMLInputElement>(null);

  // Cada resposta desce a lista até o fim: numa conversa, o que acabou de
  // chegar é o que a pessoa quer ler.
  useEffect(() => {
    if (open) fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [itens, open]);

  /*
   * A miniatura vive num `objectURL`, e ele não pode ser revogado no envio: a
   * mesma URL passa a ser a imagem que fica no histórico da conversa. Revogar
   * ali deixaria a foto quebrada no balão logo depois de mandá-la.
   *
   * Então o descarte é explícito — ao remover o anexo, ao limpar a conversa e
   * ao desmontar a gaveta —, e a URL vive enquanto alguém puder olhar para ela.
   */
  const previews = useRef<string[]>([]);
  useEffect(() => {
    const urls = previews.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.length = 0;
    };
  }, []);

  function esquecerPreview(url: string | undefined) {
    if (!url) return;
    URL.revokeObjectURL(url);
    previews.current = previews.current.filter((item) => item !== url);
  }

  function limparConversa() {
    itens.forEach((item) => esquecerPreview(item.imagemPreview));
    setItens([]);
  }

  useEffect(() => {
    if (gravacao.erro) toast.error(gravacao.erro);
  }, [gravacao.erro]);

  async function enviarMensagem(mensagem: string, comAnexo?: Anexo | null) {
    const limpa = mensagem.trim();
    const anexado = comAnexo ?? null;
    if ((!limpa && !anexado) || enviar.isPending || !profileId) return;

    const historico: HistoricoChat[] = itens
      .filter((item) => !item.erro && item.texto)
      .map((item) => ({ role: item.role, content: item.texto }));

    const pergunta: ItemChat = {
      id: crypto.randomUUID(),
      role: "user",
      // Enquanto o áudio não volta transcrito, o balão diz o que está havendo;
      // quando a transcrição chega, ela toma o lugar deste texto.
      texto: limpa || (anexado?.tipo === "audio" ? "Transcrevendo o áudio…" : ""),
      ...(anexado?.preview ? { imagemPreview: anexado.preview } : {}),
    };
    setItens((atuais) => [...atuais, pergunta]);
    setTexto("");
    setAnexo(null);

    try {
      const reply = await enviar.mutateAsync({
        profileId,
        mensagem: limpa,
        historico,
        ...(anexado?.tipo === "imagem" ? { imagem: anexado.midia } : {}),
        ...(anexado?.tipo === "audio" ? { audio: anexado.midia } : {}),
      });

      setItens((atuais) => [
        // O áudio é a própria fala da pessoa: a transcrição vira o balão dela,
        // e não uma nota de rodapé na resposta.
        ...atuais.map((item) =>
          item.id === pergunta.id && reply.origem?.tipo === "audio"
            ? { ...item, texto: reply.origem.extraido }
            : item,
        ),
        {
          id: crypto.randomUUID(),
          role: "assistant" as const,
          texto: reply.texto,
          reply,
          ...(reply.tipo === "rascunho" ? { rascunho: reply.rascunho } : {}),
          // A imagem deixa o log visível; o áudio já virou o balão acima.
          ...(reply.origem?.tipo === "imagem" ? { origem: reply.origem } : {}),
        },
      ]);
    } catch (error) {
      setItens((atuais) => [
        ...atuais.map((item) =>
          item.id === pergunta.id && item.texto === "Transcrevendo o áudio…"
            ? { ...item, texto: "Áudio enviado" }
            : item,
        ),
        {
          id: crypto.randomUUID(),
          role: "assistant",
          texto: error instanceof Error ? error.message : "Não consegui responder agora.",
          erro: true,
        },
      ]);
    }
  }

  async function escolherImagem(arquivo: File | undefined) {
    if (!arquivo) return;
    setPreparando(true);
    try {
      const midia = await prepararImagem(arquivo);
      const preview = URL.createObjectURL(arquivo);
      previews.current.push(preview);
      setAnexo({ tipo: "imagem", midia, preview });
    } catch {
      toast.error("Não consegui preparar essa imagem");
    } finally {
      setPreparando(false);
      // Permite reanexar o mesmo arquivo depois de descartá-lo.
      if (seletorImagem.current) seletorImagem.current.value = "";
    }
  }

  /**
   * Parar de gravar envia. É o que "entrada automática" quer dizer: falar já é
   * mandar, sem uma confirmação no meio que transformaria dois toques em três.
   */
  async function pararEEnviar() {
    const segundos = gravacao.duracao;
    const blob = await gravacao.parar();
    if (!blob) return;

    setPreparando(true);
    try {
      const base64 = await arquivoParaBase64(blob);
      const extensao = blob.type.includes("mp4") ? "mp4" : "webm";
      await enviarMensagem(texto, {
        tipo: "audio",
        midia: { nome: `audio.${extensao}`, mime: blob.type || "audio/webm", base64 },
        segundos,
      });
    } catch {
      toast.error("Não consegui preparar o áudio");
    } finally {
      setPreparando(false);
    }
  }

  function atualizarRascunho(id: string, rascunho: RascunhoLancamento) {
    setItens((atuais) => atuais.map((item) => (item.id === id ? { ...item, rascunho } : item)));
  }

  async function confirmarRascunho(id: string, rascunho: RascunhoLancamento) {
    if (!profileId || confirmandoId) return;
    setConfirmandoId(id);
    try {
      const { criados } = await confirmar.mutateAsync({ profileId, rascunho });
      setItens((atuais) =>
        atuais.map((item) => (item.id === id ? { ...item, confirmado: criados } : item)),
      );
      toast.success(criados === 1 ? "Lançamento registrado" : `${criados} parcelas registradas`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não consegui registrar");
    } finally {
      setConfirmandoId(null);
    }
  }

  function descartar(id: string) {
    setItens((atuais) =>
      atuais.map((item) =>
        item.id === id
          ? { id: item.id, role: "assistant", texto: "Rascunho descartado. Nada foi registrado." }
          : item,
      ),
    );
  }

  const ocupado = enviar.isPending || preparando;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        aria-describedby={undefined}
      >
        <header className="flex items-center gap-2.5 border-b border-border p-4">
          <span className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-xl">
            <Sparkles className="size-4" strokeWidth={2.5} />
          </span>
          <div className="min-w-0 flex-1">
            <SheetTitle className="text-base">Assistente</SheetTitle>
            <p className="truncate text-xs text-muted-foreground">
              Escreva, fotografe o comprovante ou fale
            </p>
          </div>
          {itens.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Limpar conversa"
              onClick={limparConversa}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {itens.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Escreva o que você quer consultar ou lançar — ou mande a foto de um comprovante, ou
                grave um áudio. Um lançamento sempre aparece como rascunho para você revisar; nada
                vai para o banco sem a sua confirmação.
              </p>
              <div className="space-y-1.5">
                {EXEMPLOS.map((exemplo) => (
                  <button
                    key={exemplo}
                    type="button"
                    onClick={() => void enviarMensagem(exemplo)}
                    className="block w-full rounded-xl border border-border bg-card px-3 py-2 text-left text-sm transition-colors hover:border-border-strong hover:bg-accent"
                  >
                    {exemplo}
                  </button>
                ))}
              </div>
            </div>
          )}

          {itens.map((item) => (
            <div key={item.id} className="flex gap-2.5">
              <span
                className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${
                  item.role === "user"
                    ? "bg-muted text-muted-foreground"
                    : item.erro
                      ? "bg-negative-soft text-negative-soft-foreground"
                      : "bg-primary-soft text-primary-soft-foreground"
                }`}
                aria-hidden
              >
                {item.role === "user" ? (
                  <User className="size-3.5" />
                ) : item.erro ? (
                  <AlertTriangle className="size-3.5" />
                ) : (
                  <Bot className="size-3.5" />
                )}
              </span>

              <div className="min-w-0 flex-1">
                {item.imagemPreview && (
                  <img
                    src={item.imagemPreview}
                    alt="Comprovante enviado"
                    className="mb-1.5 max-h-40 rounded-xl border border-border object-contain"
                  />
                )}

                {item.texto && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.texto}</p>
                )}

                {item.origem && <ChatOrigemMidia origem={item.origem} />}

                {item.reply?.tipo === "consulta" && (
                  <ChatConsultaCard consulta={item.reply.consulta} />
                )}

                {item.rascunho && (
                  <ChatDraftCard
                    rascunho={item.rascunho}
                    categories={categories ?? []}
                    onChange={(rascunho) => atualizarRascunho(item.id, rascunho)}
                    onConfirm={() => void confirmarRascunho(item.id, item.rascunho!)}
                    onDescartar={() => descartar(item.id)}
                    pending={confirmandoId === item.id}
                    confirmado={item.confirmado ?? null}
                  />
                )}
              </div>
            </div>
          ))}

          {ocupado && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              {preparando ? "Preparando o anexo…" : "Interpretando…"}
            </p>
          )}

          <div ref={fim} />
        </div>

        <footer className="space-y-2 border-t border-border p-3">
          {anexo?.preview && (
            <div className="flex items-center gap-2 rounded-xl border border-border bg-muted/40 p-2">
              <img
                src={anexo.preview}
                alt=""
                className="size-10 shrink-0 rounded-lg object-cover"
              />
              <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                Imagem pronta para enviar. Se quiser, escreva algo junto.
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-7 shrink-0"
                aria-label="Remover imagem"
                onClick={() => {
                  esquecerPreview(anexo.preview);
                  setAnexo(null);
                }}
              >
                <X className="size-3.5" />
              </Button>
            </div>
          )}

          {gravacao.gravando ? (
            <div className="flex items-center gap-2 rounded-xl border border-negative/30 bg-negative-soft px-3 py-2">
              <span
                className="size-2 shrink-0 animate-pulse rounded-full bg-negative"
                aria-hidden
              />
              <span className="min-w-0 flex-1 text-sm font-medium tabular-nums text-negative-soft-foreground">
                Gravando… {formatarDuracao(gravacao.duracao)}
              </span>
              <Button variant="ghost" size="sm" onClick={gravacao.cancelar}>
                Cancelar
              </Button>
              <Button size="sm" onClick={() => void pararEEnviar()}>
                <Square className="size-3.5" />
                Enviar
              </Button>
            </div>
          ) : (
            <div className="flex items-end gap-2">
              <input
                ref={seletorImagem}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void escolherImagem(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                size="icon"
                className="size-11 shrink-0"
                aria-label="Anexar foto de comprovante"
                disabled={ocupado || !!anexo}
                onClick={() => seletorImagem.current?.click()}
              >
                <ImagePlus className="size-4" />
              </Button>

              {gravacao.suportado && (
                <Button
                  variant="outline"
                  size="icon"
                  className="size-11 shrink-0"
                  aria-label="Gravar áudio"
                  disabled={ocupado || !!anexo}
                  onClick={() => void gravacao.iniciar()}
                >
                  <Mic className="size-4" />
                </Button>
              )}

              <Textarea
                value={texto}
                onChange={(e) => setTexto(e.target.value.slice(0, MAX_MENSAGEM_CHAT))}
                onKeyDown={(e) => {
                  // Enter envia, Shift+Enter quebra linha: é o que a mão espera
                  // num campo de conversa.
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    void enviarMensagem(texto, anexo);
                  }
                }}
                placeholder={anexo ? "Algo a acrescentar? (opcional)" : "Gastei 158 no mercado…"}
                rows={2}
                className="max-h-32 min-h-11 resize-none"
                aria-label="Mensagem para o assistente"
              />
              <Button
                size="icon"
                className="size-11 shrink-0"
                aria-label="Enviar"
                disabled={(!texto.trim() && !anexo) || ocupado}
                onClick={() => void enviarMensagem(texto, anexo)}
              >
                <CornerDownLeft className="size-4" />
              </Button>
            </div>
          )}
        </footer>
      </SheetContent>
    </Sheet>
  );
}

/**
 * Botão que abre o assistente, com a gaveta junto.
 *
 * Some por completo quando o servidor não tem chave de IA configurada: um botão
 * que só sabe dizer "não configurado" é pior do que botão nenhum.
 */
export function AiChatLauncher() {
  const [open, setOpen] = useState(false);
  const { data: config } = useChatConfig();

  if (!config?.enabled) return null;

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="gap-1.5"
        aria-label="Abrir o assistente de IA"
      >
        <Sparkles className="size-4" />
        <span className="hidden sm:inline">Assistente</span>
      </Button>
      <AiChatSheet open={open} onOpenChange={setOpen} />
    </>
  );
}

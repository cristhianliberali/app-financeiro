import { useEffect, useRef, useState, type ReactNode } from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import {
  AlertTriangle,
  ArrowUp,
  ChevronDown,
  ImagePlus,
  Mic,
  Sparkles,
  Square,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
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
 * O assistente de IA do Finanças, como widget de chat.
 *
 * É um painel flutuante ancorado sobre a bolha, e não uma gaveta que toma a
 * lateral inteira: o formato que todo mundo já reconhece de um chat de site.
 * A diferença não é só estética — a gaveta cobria a tela que a pergunta é
 * sobre, e perguntar "quanto gastei em alimentação?" enquanto o painel esconde
 * o painel de gastos é trabalhar contra o próprio recurso.
 *
 * Por isso o diálogo é `modal={false}` e não tem véu: a página continua visível
 * e utilizável atrás, como num widget de verdade. Clique fora não fecha — a
 * conversa e o rascunho em revisão sobreviveriam a um clique distraído.
 *
 * A conversa vive só nesta tela: nada é guardado em banco, e fechar o painel
 * mantém o que já foi dito enquanto a página não recarrega. É de propósito — o
 * valor do recurso está no que ele registra e responde, não num histórico de
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
  /** Quando a mensagem entrou na conversa, para a hora abaixo do balão. */
  at: number;
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
  "Meu saldo no mês passado",
  "Paguei 1.200 de aluguel ontem",
];

/** Teto do campo de escrita antes de ele passar a rolar. */
const ALTURA_MAX_CAMPO = 112;

const hora = (at: number) =>
  new Date(at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

export function AiChatWidget({
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
  const campo = useRef<HTMLTextAreaElement>(null);

  // Cada resposta desce a lista até o fim: numa conversa, o que acabou de
  // chegar é o que a pessoa quer ler.
  useEffect(() => {
    if (open) fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [itens, open, enviar.isPending]);

  /*
   * A miniatura vive num `objectURL`, e ele não pode ser revogado no envio: a
   * mesma URL passa a ser a imagem que fica no histórico da conversa. Revogar
   * ali deixaria a foto quebrada no balão logo depois de mandá-la.
   *
   * Então o descarte é explícito — ao remover o anexo, ao limpar a conversa e
   * ao desmontar o widget —, e a URL vive enquanto alguém puder olhar para ela.
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

  /** O campo cresce com o texto até o teto, e volta ao tamanho de uma linha ao esvaziar. */
  function ajustarAltura() {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, ALTURA_MAX_CAMPO)}px`;
  }

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
      at: Date.now(),
      // Enquanto o áudio não volta transcrito, o balão diz o que está havendo;
      // quando a transcrição chega, ela toma o lugar deste texto.
      texto: limpa || (anexado?.tipo === "audio" ? "Transcrevendo o áudio…" : ""),
      ...(anexado?.preview ? { imagemPreview: anexado.preview } : {}),
    };
    setItens((atuais) => [...atuais, pergunta]);
    setTexto("");
    setAnexo(null);
    requestAnimationFrame(ajustarAltura);

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
          at: Date.now(),
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
          at: Date.now(),
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
          ? {
              id: item.id,
              role: "assistant",
              at: item.at,
              texto: "Rascunho descartado. Nada foi registrado.",
            }
          : item,
      ),
    );
  }

  const ocupado = enviar.isPending || preparando;
  const podeEnviar = (!!texto.trim() || !!anexo) && !ocupado;

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // Clique fora não fecha: um rascunho em revisão não pode sumir porque
          // a pessoa encostou no resto da página — que segue utilizável atrás.
          onInteractOutside={(e) => e.preventDefault()}
          className={
            "fixed z-40 flex flex-col overflow-hidden rounded-2xl border border-border bg-card " +
            "shadow-2xl duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out " +
            "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 " +
            "data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 " +
            // Celular: quase a tela inteira, mas com a moldura arredondada que
            // diz que é um painel sobre a página, e não outra tela.
            "inset-x-2 bottom-2 top-2 " +
            // Desktop: cartão estreito ancorado logo acima da bolha.
            "sm:inset-auto sm:bottom-24 sm:right-6 sm:h-[min(36rem,calc(100vh-9rem))] sm:w-96"
          }
        >
          <header className="flex items-center gap-2.5 border-b border-border/70 px-3.5 py-3">
            <span className="brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full shadow-glow">
              <Sparkles className="size-4" strokeWidth={2.5} />
            </span>
            <div className="min-w-0 flex-1">
              <DialogPrimitive.Title className="truncate text-sm font-semibold tracking-tight">
                Assistente
              </DialogPrimitive.Title>
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <span className="size-1.5 shrink-0 rounded-full bg-positive" aria-hidden />
                Consulta e lança na hora
              </p>
            </div>
            {itens.length > 0 && (
              <button
                type="button"
                onClick={limparConversa}
                aria-label="Limpar conversa"
                title="Limpar conversa"
                className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <Trash2 className="size-4" />
              </button>
            )}
            <DialogPrimitive.Close
              aria-label="Fechar o assistente"
              className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto bg-background px-3.5 py-4">
            {itens.length === 0 && (
              <div className="space-y-3">
                <Balao>
                  Oi! Posso responder quanto você gastou num período e registrar lançamentos a
                  partir do que você escrever, de uma foto de comprovante ou de um áudio.
                  <br />
                  <br />
                  Todo lançamento aparece como rascunho para você revisar — nada vai para o banco
                  sem a sua confirmação.
                </Balao>
                <div className="flex flex-wrap gap-1.5 pl-8">
                  {EXEMPLOS.map((exemplo) => (
                    <button
                      key={exemplo}
                      type="button"
                      onClick={() => void enviarMensagem(exemplo)}
                      className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary-soft hover:text-primary-soft-foreground"
                    >
                      {exemplo}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {itens.map((item) =>
              item.role === "user" ? (
                <div key={item.id} className="flex flex-col items-end gap-1">
                  {item.imagemPreview && (
                    <img
                      src={item.imagemPreview}
                      alt="Comprovante enviado"
                      className="max-h-44 rounded-2xl rounded-br-md border border-border object-contain"
                    />
                  )}
                  {item.texto && (
                    <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
                      {item.texto}
                    </p>
                  )}
                  <span className="pr-1 text-[10px] text-muted-foreground">{hora(item.at)}</span>
                </div>
              ) : (
                <div key={item.id} className="flex gap-2">
                  <span
                    className={`mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full ${
                      item.erro
                        ? "bg-negative-soft text-negative-soft-foreground"
                        : "brand-gradient"
                    }`}
                    aria-hidden
                  >
                    {item.erro ? (
                      <AlertTriangle className="size-3" />
                    ) : (
                      <Sparkles className="size-3" strokeWidth={2.5} />
                    )}
                  </span>

                  <div className="min-w-0 flex-1 space-y-1">
                    <p
                      className={`w-fit max-w-[92%] whitespace-pre-wrap rounded-2xl rounded-tl-md px-3.5 py-2.5 text-sm leading-relaxed ${
                        item.erro
                          ? "bg-negative-soft text-negative-soft-foreground"
                          : "bg-muted text-foreground"
                      }`}
                    >
                      {item.texto}
                    </p>

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

                    <span className="block pl-1 text-[10px] text-muted-foreground">
                      {hora(item.at)}
                    </span>
                  </div>
                </div>
              ),
            )}

            {ocupado && (
              <div className="flex gap-2">
                <span
                  className="brand-gradient mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
                  aria-hidden
                >
                  <Sparkles className="size-3" strokeWidth={2.5} />
                </span>
                <p
                  className="flex items-center gap-1 rounded-2xl rounded-tl-md bg-muted px-4 py-3"
                  aria-label={preparando ? "Preparando o anexo" : "Interpretando"}
                >
                  {[0, 150, 300].map((atraso) => (
                    <span
                      key={atraso}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none"
                      style={{ animationDelay: `${atraso}ms` }}
                    />
                  ))}
                </p>
              </div>
            )}

            <div ref={fim} />
          </div>

          <footer className="space-y-2 border-t border-border/70 p-2.5">
            {anexo?.preview && (
              <div className="flex items-center gap-2 rounded-xl border border-border bg-background p-1.5">
                <img
                  src={anexo.preview}
                  alt=""
                  className="size-9 shrink-0 rounded-lg object-cover"
                />
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  Imagem pronta. Escreva algo junto, se quiser.
                </span>
                <button
                  type="button"
                  aria-label="Remover imagem"
                  onClick={() => {
                    esquecerPreview(anexo.preview);
                    setAnexo(null);
                  }}
                  className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            )}

            {gravacao.gravando ? (
              <div className="flex items-center gap-2 rounded-2xl border border-negative/30 bg-negative-soft px-3 py-2">
                <span
                  className="size-2 shrink-0 animate-pulse rounded-full bg-negative motion-reduce:animate-none"
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
              /*
               * Campo e ações num cartão só, e não numa fileira de caixas: é o
               * formato de composer que as pessoas já usam em todo lugar, e
               * deixa o botão de enviar onde o polegar termina a frase.
               */
              <div className="rounded-2xl border border-input bg-background p-1.5 transition-colors focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/20">
                <input
                  ref={seletorImagem}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => void escolherImagem(e.target.files?.[0])}
                />
                <textarea
                  ref={campo}
                  value={texto}
                  rows={1}
                  onChange={(e) => {
                    setTexto(e.target.value.slice(0, MAX_MENSAGEM_CHAT));
                    ajustarAltura();
                  }}
                  onKeyDown={(e) => {
                    // Enter envia, Shift+Enter quebra linha: é o que a mão
                    // espera num campo de conversa.
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      void enviarMensagem(texto, anexo);
                    }
                  }}
                  placeholder={anexo ? "Algo a acrescentar? (opcional)" : "Escreva uma mensagem…"}
                  aria-label="Mensagem para o assistente"
                  className="block max-h-28 w-full resize-none bg-transparent px-2 py-1.5 text-sm leading-relaxed outline-none placeholder:text-muted-foreground"
                />
                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    aria-label="Anexar foto de comprovante"
                    title="Foto de comprovante"
                    disabled={ocupado || !!anexo}
                    onClick={() => seletorImagem.current?.click()}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                  >
                    <ImagePlus className="size-4" />
                  </button>
                  {gravacao.suportado && (
                    <button
                      type="button"
                      aria-label="Gravar áudio"
                      title="Gravar áudio"
                      disabled={ocupado || !!anexo}
                      onClick={() => void gravacao.iniciar()}
                      className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
                    >
                      <Mic className="size-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    aria-label="Enviar"
                    disabled={!podeEnviar}
                    onClick={() => void enviarMensagem(texto, anexo)}
                    className="ml-auto flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
                  >
                    <ArrowUp className="size-4" strokeWidth={2.5} />
                  </button>
                </div>
              </div>
            )}
          </footer>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/** Balão do assistente sem mensagem própria — o texto de boas-vindas. */
function Balao({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span
        className="brand-gradient mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full"
        aria-hidden
      >
        <Sparkles className="size-3" strokeWidth={2.5} />
      </span>
      <p className="max-w-[92%] rounded-2xl rounded-tl-md bg-muted px-3.5 py-2.5 text-sm leading-relaxed">
        {children}
      </p>
    </div>
  );
}

/**
 * A bolha que abre o assistente, com o painel junto.
 *
 * Fica ancorada no canto inferior direito, sobre o conteúdo. É o gesto que as
 * pessoas já conhecem de qualquer chat de site: a bolha está sempre no mesmo
 * lugar, não disputa espaço com os seletores de conta e período, e no celular
 * cai bem debaixo do polegar — onde o cabeçalho, encostado no topo da tela, é o
 * ponto mais difícil de alcançar.
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
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={open ? "Fechar o assistente de IA" : "Abrir o assistente de IA"}
        aria-expanded={open}
        title="Assistente"
        /*
         * z-30 é o andar entre o conteúdo e o cabeçalho fixo (z-20) de um lado
         * e o painel (z-40) do outro: a bolha passa por cima da página e fica
         * logo abaixo do chat, que abre ancorado nela.
         */
        className="brand-gradient fixed bottom-5 right-4 z-30 flex size-14 items-center justify-center rounded-full shadow-glow outline-none transition-transform hover:scale-105 focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100 lg:bottom-6 lg:right-6"
        /*
         * Levanta a bolha acima da barra de gestos do iPhone. Onde a variável
         * não existe ela vale zero, e a margem simplesmente não faz nada.
         */
        style={{ marginBottom: "env(safe-area-inset-bottom)" }}
      >
        {/* Aberto, a bolha vira o gesto de recolher — como em qualquer widget. */}
        {open ? (
          <ChevronDown className="size-6" strokeWidth={2.5} />
        ) : (
          <Sparkles className="size-6" strokeWidth={2.2} />
        )}
      </button>
      <AiChatWidget open={open} onOpenChange={setOpen} />
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Bot, CornerDownLeft, Sparkles, Trash2, User } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useAppState } from "@/lib/app-state";
import { useCategories } from "@/lib/data";
import {
  useChatConfig,
  useChatMessage,
  useConfirmarRascunho,
  type ChatReply,
  type HistoricoChat,
  type RascunhoLancamento,
} from "@/lib/chat";
import { MAX_MENSAGEM_CHAT } from "@/lib/chat.functions";

import { ChatConsultaCard } from "./ChatConsultaCard";
import { ChatDraftCard } from "./ChatDraftCard";

/**
 * O assistente de IA do Finanças.
 *
 * A conversa vive só nesta tela: nada é guardado em banco, e fechar a gaveta
 * mantém o que já foi dito enquanto a página não recarrega. É de propósito —
 * o valor do recurso está no que ele registra e responde, não num histórico de
 * conversa que ninguém volta a ler.
 *
 * O ciclo é sempre o mesmo: a pessoa escreve, a IA interpreta, e o que volta é
 * ou uma resposta com números vindos do banco, ou um rascunho para revisar. A
 * IA nunca grava nada; quem grava é o botão "Confirmar" do rascunho.
 */

type ItemChat = {
  id: string;
  role: "user" | "assistant";
  texto: string;
  reply?: ChatReply;
  /** Rascunho em edição — parte do item, para cada proposta ter o seu. */
  rascunho?: RascunhoLancamento;
  /** Quantos lançamentos este rascunho gerou depois de confirmado. */
  confirmado?: number;
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

  const [itens, setItens] = useState<ItemChat[]>([]);
  const [texto, setTexto] = useState("");
  /** Qual rascunho está sendo gravado — com dois na tela, só um mostra "Registrando…". */
  const [confirmandoId, setConfirmandoId] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);

  // Cada resposta desce a lista até o fim: numa conversa, o que acabou de
  // chegar é o que a pessoa quer ler.
  useEffect(() => {
    if (open) fim.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [itens, open]);

  async function enviarMensagem(mensagem: string) {
    const limpa = mensagem.trim();
    if (!limpa || enviar.isPending || !profileId) return;

    const historico: HistoricoChat[] = itens
      .filter((item) => !item.erro)
      .map((item) => ({ role: item.role, content: item.texto }));

    const pergunta: ItemChat = { id: crypto.randomUUID(), role: "user", texto: limpa };
    setItens((atuais) => [...atuais, pergunta]);
    setTexto("");

    try {
      const reply = await enviar.mutateAsync({ profileId, mensagem: limpa, historico });
      setItens((atuais) => [
        ...atuais,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          texto: reply.texto,
          reply,
          ...(reply.tipo === "rascunho" ? { rascunho: reply.rascunho } : {}),
        },
      ]);
    } catch (error) {
      setItens((atuais) => [
        ...atuais,
        {
          id: crypto.randomUUID(),
          role: "assistant",
          texto: error instanceof Error ? error.message : "Não consegui responder agora.",
          erro: true,
        },
      ]);
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
              Consulte gastos e registre lançamentos escrevendo
            </p>
          </div>
          {itens.length > 0 && (
            <Button
              variant="ghost"
              size="icon"
              aria-label="Limpar conversa"
              onClick={() => setItens([])}
            >
              <Trash2 className="size-4" />
            </Button>
          )}
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
          {itens.length === 0 && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Escreva o que você quer consultar ou lançar. Um lançamento sempre aparece como
                rascunho para você revisar — nada vai para o banco sem a sua confirmação.
              </p>
              <div className="space-y-1.5">
                {EXEMPLOS.map((exemplo) => (
                  <button
                    key={exemplo}
                    type="button"
                    onClick={() => enviarMensagem(exemplo)}
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
                <p className="whitespace-pre-wrap text-sm leading-relaxed">{item.texto}</p>

                {item.reply?.tipo === "consulta" && (
                  <ChatConsultaCard consulta={item.reply.consulta} />
                )}

                {item.rascunho && (
                  <ChatDraftCard
                    rascunho={item.rascunho}
                    categories={categories ?? []}
                    onChange={(rascunho) => atualizarRascunho(item.id, rascunho)}
                    onConfirm={() => confirmarRascunho(item.id, item.rascunho!)}
                    onDescartar={() => descartar(item.id)}
                    pending={confirmandoId === item.id}
                    confirmado={item.confirmado ?? null}
                  />
                )}
              </div>
            </div>
          ))}

          {enviar.isPending && (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <span className="size-4 animate-spin rounded-full border-2 border-border border-t-primary" />
              Interpretando…
            </p>
          )}

          <div ref={fim} />
        </div>

        <footer className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={texto}
              onChange={(e) => setTexto(e.target.value.slice(0, MAX_MENSAGEM_CHAT))}
              onKeyDown={(e) => {
                // Enter envia, Shift+Enter quebra linha: é o que a mão espera
                // num campo de conversa.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void enviarMensagem(texto);
                }
              }}
              placeholder="Gastei 158 no mercado…"
              rows={2}
              className="max-h-32 min-h-11 resize-none"
              aria-label="Mensagem para o assistente"
            />
            <Button
              size="icon"
              className="size-11 shrink-0"
              aria-label="Enviar"
              disabled={!texto.trim() || enviar.isPending}
              onClick={() => void enviarMensagem(texto)}
            >
              <CornerDownLeft className="size-4" />
            </Button>
          </div>
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

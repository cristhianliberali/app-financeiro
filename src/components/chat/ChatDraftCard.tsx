import { useState, type ReactNode } from "react";
import { Check, CircleDashed, Layers, Pencil, Trash2, Wallet, type LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import { CategorySelect } from "@/components/CategorySelect";
import { MAX_INSTALLMENTS, buildInstallments } from "@/lib/installments";
import { brl, formatDateBR } from "@/lib/format";
import { activeCategories, type Category } from "@/lib/data";
import type { RascunhoLancamento } from "@/lib/chat-contract";

/**
 * O rascunho de lançamento, do jeito que a pessoa revisa antes de confirmar.
 *
 * Este cartão é a trava do recurso inteiro: a IA interpretou a frase e propôs,
 * mas nada foi gravado — o botão "Confirmar" é o único caminho até o banco.
 * Por isso os dados aparecem por extenso (valor, data, categoria, situação) em
 * vez de resumidos: o que não está à vista não pode ser conferido.
 *
 * A revisão abre fechada, com atalhos para o que muda com mais frequência
 * (pago/em aberto, hoje/ontem). "Editar" abre os campos completos — quem só
 * quis lançar 158 no mercado confirma em um clique; quem precisa corrigir a
 * data tem o formulário inteiro a um clique de distância.
 */
export function ChatDraftCard({
  rascunho,
  categories,
  onChange,
  onConfirm,
  onDescartar,
  pending,
  confirmado,
}: {
  rascunho: RascunhoLancamento;
  categories: Category[];
  onChange: (rascunho: RascunhoLancamento) => void;
  onConfirm: () => void;
  onDescartar: () => void;
  pending: boolean;
  /** Quantos lançamentos foram gravados; preenchido depois de confirmar. */
  confirmado: number | null;
}) {
  const [editando, setEditando] = useState(false);
  /*
   * O campo de valor guarda o texto digitado, e não o número.
   *
   * Controlá-lo direto pelo número faria "158," virar "158" no meio da
   * digitação, e o cursor pularia para trás a cada centavo: o campo brigaria
   * com quem está corrigindo um valor. Aqui o texto é da pessoa, e o número só
   * é atualizado quando o que ela escreveu já é um número.
   */
  const [valorTexto, setValorTexto] = useState(() => String(rascunho.amount).replace(".", ","));
  const [parcelasTexto, setParcelasTexto] = useState(() => String(rascunho.parcelas));

  const disponiveis = activeCategories(categories).filter(
    (categoria) => categoria.kind === rascunho.kind,
  );
  const categoria = categories.find((item) => item.id === rascunho.category_id) ?? null;
  const parcelas =
    rascunho.parcelas > 1
      ? buildInstallments({
          total: rascunho.amount,
          count: rascunho.parcelas,
          firstDueDate: rascunho.due_date,
        })
      : [];

  if (confirmado !== null) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-xl border border-positive/30 bg-positive-soft px-3 py-2.5 text-sm text-positive-soft-foreground">
        <Check className="size-4 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {confirmado === 1
            ? `Registrado: ${rascunho.description} · ${brl(rascunho.amount)}`
            : `${confirmado} parcelas registradas: ${rascunho.description}`}
        </span>
      </div>
    );
  }

  return (
    <div className="mt-2 space-y-3 rounded-xl border border-border bg-background/60 p-3">
      <div className="flex items-start gap-2">
        <span
          className={`mt-1 size-2 shrink-0 rounded-full ${
            rascunho.kind === "income" ? "bg-positive" : "bg-negative"
          }`}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{rascunho.description}</p>
          <p className="text-xs text-muted-foreground">
            {formatDateBR(rascunho.transaction_date)} ·{" "}
            {categoria?.name ?? (
              <span className="font-medium text-negative">escolha uma categoria</span>
            )}
          </p>
        </div>
        <span
          className={`shrink-0 text-base font-semibold tabular-nums ${
            rascunho.kind === "income" ? "text-positive" : "text-negative"
          }`}
        >
          {rascunho.kind === "income" ? "+" : "−"} {brl(rascunho.amount)}
        </span>
      </div>

      {/* Atalhos: a situação e o parcelamento resolvidos sem abrir o formulário. */}
      <div className="flex flex-wrap gap-1.5">
        <Atalho
          ativo={rascunho.status === "paid"}
          icon={rascunho.status === "paid" ? Wallet : CircleDashed}
          onClick={() =>
            onChange({ ...rascunho, status: rascunho.status === "paid" ? "pending" : "paid" })
          }
        >
          {rascunho.status === "paid" ? "Já paguei" : "Em aberto"}
        </Atalho>
        {parcelas.length > 0 && (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground">
            <Layers className="size-3" />
            {parcelas.length}× {brl(parcelas[0]!.amount)}
          </span>
        )}
        <Atalho ativo={editando} icon={Pencil} onClick={() => setEditando((v) => !v)}>
          {editando ? "Fechar edição" : "Editar"}
        </Atalho>
      </div>

      {editando && (
        <div className="grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="chat-descricao">Descrição</Label>
            <Input
              id="chat-descricao"
              value={rascunho.description}
              onChange={(e) => onChange({ ...rascunho, description: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chat-valor">
              {rascunho.parcelas > 1 ? "Valor total da compra" : "Valor"}
            </Label>
            <Input
              id="chat-valor"
              inputMode="decimal"
              value={valorTexto}
              onChange={(e) => {
                setValorTexto(e.target.value);
                const numero = Number(e.target.value.replace(",", "."));
                if (e.target.value.trim() && Number.isFinite(numero) && numero >= 0) {
                  onChange({ ...rascunho, amount: numero });
                }
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chat-data">Data</Label>
            <DateField
              id="chat-data"
              type="date"
              value={rascunho.transaction_date}
              onChange={(e) =>
                // As duas datas andam juntas no chat: separar vencimento de data
                // do movimento é ajuste fino, e para isso existe a tela de
                // transações. Aqui atrapalharia mais do que ajudaria.
                onChange({
                  ...rascunho,
                  transaction_date: e.target.value,
                  due_date: e.target.value,
                })
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chat-categoria">Categoria</Label>
            <CategorySelect
              id="chat-categoria"
              categories={disponiveis}
              value={rascunho.category_id ?? ""}
              onChange={(id) => onChange({ ...rascunho, category_id: id })}
              invalid={!rascunho.category_id}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="chat-parcelas">Parcelas</Label>
            <Input
              id="chat-parcelas"
              inputMode="numeric"
              value={parcelasTexto}
              onChange={(e) => {
                // Deixa o campo ficar vazio enquanto se troca o número; o
                // rascunho só muda quando há um valor de fato.
                setParcelasTexto(e.target.value.replace(/\D/g, ""));
                const numero = Math.trunc(Number(e.target.value.replace(/\D/g, "")));
                if (numero >= 1) {
                  onChange({ ...rascunho, parcelas: Math.min(MAX_INSTALLMENTS, numero) });
                }
              }}
              onBlur={() => setParcelasTexto(String(rascunho.parcelas))}
            />
          </div>
        </div>
      )}

      {/*
        Categoria é exigida aqui e no servidor: sem ela o lançamento sumiria do
        teto, do gráfico e de qualquer leitura que não seja o extrato cru.
      */}
      {!rascunho.category_id && !editando && (
        <div className="space-y-1.5">
          <Label htmlFor="chat-categoria-rapida">Categoria</Label>
          <CategorySelect
            id="chat-categoria-rapida"
            categories={disponiveis}
            value=""
            onChange={(id) => onChange({ ...rascunho, category_id: id })}
            invalid
          />
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={onConfirm} disabled={pending || !rascunho.category_id}>
          <Check className="size-4" />
          {pending ? "Registrando…" : rascunho.parcelas > 1 ? "Confirmar parcelas" : "Confirmar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onDescartar} disabled={pending}>
          <Trash2 className="size-4" />
          Descartar
        </Button>
      </div>
    </div>
  );
}

function Atalho({
  ativo,
  icon: Icon,
  onClick,
  children,
}: {
  ativo: boolean;
  icon: LucideIcon;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-medium transition-colors ${
        ativo
          ? "border-primary/30 bg-primary-soft text-primary-soft-foreground"
          : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
      }`}
    >
      <Icon className="size-3" />
      {children}
    </button>
  );
}

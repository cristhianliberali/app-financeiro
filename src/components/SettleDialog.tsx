import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { brl } from "@/lib/format";
import type { Transaction } from "@/lib/data";

/**
 * Confirmação do valor real ao dar baixa numa recorrência variável.
 *
 * Conta de luz nasce com uma estimativa, porque um valor precisa existir para o
 * mês fechar em previsão. Mas dar baixa nela pelo valor estimado transforma um
 * palpite em fato no extrato, em silêncio — e o mês inteiro passa a mentir por
 * uma diferença que ninguém digitou. Aqui a baixa para e pergunta.
 *
 * Só as ocorrências de regra variável entram; o resto passa direto. Perguntar o
 * valor do aluguel todo mês seria a mesma interrupção sem nenhum ganho.
 *
 * O valor confirmado vale só para aquela ocorrência: a regra mantém a
 * estimativa e os meses seguintes continuam nascendo com ela.
 */
export type SettleAmount = { id: string; amount: number };

export function SettleDialog({
  open,
  onOpenChange,
  items,
  onConfirm,
  pending = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Lançamentos de valor variável a confirmar. */
  items: Transaction[];
  onConfirm: (amounts: SettleAmount[]) => Promise<void> | void;
  pending?: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});

  // Reabriu com outra lista: os valores voltam a ser os estimados.
  useEffect(() => {
    if (!open) return;
    setDraft(Object.fromEntries(items.map((t) => [t.id, String(t.amount).replace(".", ",")])));
  }, [open, items]);

  const parsed = items.map((t) => ({
    tx: t,
    value: Number((draft[t.id] ?? "").replace(/\./g, "").replace(",", ".")),
  }));
  const invalid = parsed.filter((p) => !Number.isFinite(p.value) || p.value <= 0);
  const total = parsed.reduce((sum, p) => sum + (Number.isFinite(p.value) ? p.value : 0), 0);
  const estimated = items.reduce((sum, t) => sum + t.amount, 0);
  const diff = total - estimated;

  const income = items.every((t) => t.kind === "income");
  const verbo = income ? "recebido" : "pago";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Confirme o valor {income ? "recebido" : "pago"}</DialogTitle>
          <DialogDescription>
            {items.length === 1
              ? "Esta conta tem valor variável. O que foi lançado é uma estimativa."
              : `${items.length} contas de valor variável. O que foi lançado é estimativa.`}
          </DialogDescription>
        </DialogHeader>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (invalid.length === 0 && !pending) {
              void onConfirm(parsed.map((p) => ({ id: p.tx.id, amount: p.value })));
            }
          }}
        >
          <div className="space-y-3">
            {items.map((t) => (
              <div key={t.id} className="space-y-1.5">
                <Label
                  htmlFor={`baixa-${t.id}`}
                  className="flex items-baseline justify-between gap-2"
                >
                  <span className="min-w-0 truncate">{t.description}</span>
                  <span className="shrink-0 font-mono text-[11px] font-normal text-muted-foreground">
                    estimado {brl(t.amount)}
                  </span>
                </Label>
                <Input
                  id={`baixa-${t.id}`}
                  inputMode="decimal"
                  autoFocus={items.length === 1}
                  value={draft[t.id] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [t.id]: e.target.value }))}
                  aria-label={`Valor ${verbo} de ${t.description}`}
                />
              </div>
            ))}
          </div>

          {items.length > 1 && (
            <p className="flex items-center justify-between rounded-xl border border-border bg-surface px-3 py-2 text-xs">
              <span className="text-muted-foreground">Total</span>
              <span className="font-mono font-bold" data-numeric>
                {brl(total)}
              </span>
            </p>
          )}

          {/* A diferença é a informação que a confirmação existe para dar: sem
              ela, "R$ 412,80" é só mais um número na tela. */}
          {Math.abs(diff) >= 0.01 && invalid.length === 0 && (
            <p className={`text-xs ${diff > 0 ? "text-negative" : "text-positive"}`}>
              {diff > 0 ? "Acima" : "Abaixo"} do estimado em{" "}
              <span className="font-bold">{brl(Math.abs(diff))}</span>.
            </p>
          )}

          <p className="text-[11px] text-muted-foreground">
            Vale só para {items.length === 1 ? "esta ocorrência" : "estas ocorrências"}. A
            recorrência mantém o valor estimado para os próximos meses.
          </p>

          <DialogFooter>
            <Button type="button" size="sm" variant="outline" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button type="submit" size="sm" disabled={invalid.length > 0 || pending}>
              Confirmar e dar baixa
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

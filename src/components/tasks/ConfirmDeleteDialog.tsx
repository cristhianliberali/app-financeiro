import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Confirmação de exclusão para itens que levam conteúdo junto — espaços e
 * quadros. Apagar um espaço derruba em cascata seus quadros e tarefas, então
 * não basta um "tem certeza?": é preciso digitar o nome exato do item.
 */
export function ConfirmDeleteDialog({
  open,
  onOpenChange,
  itemLabel,
  itemName,
  description,
  consequences,
  confirmLabel = "Excluir definitivamente",
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "espaço", "quadro"… entra no texto do diálogo. */
  itemLabel: string;
  /** Nome que o usuário precisa digitar para liberar o botão. */
  itemName: string;
  description?: string;
  /** O que será perdido junto, listado item a item. */
  consequences?: string[];
  confirmLabel?: string;
  onConfirm: () => Promise<void> | void;
}) {
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped("");
      setBusy(false);
    }
  }, [open]);

  // Comparação tolerante a espaços nas pontas e a maiúsculas: o objetivo é
  // provar que a pessoa leu o nome, não testar a digitação dela.
  const matches = typed.trim().toLocaleLowerCase() === itemName.trim().toLocaleLowerCase();

  async function confirm() {
    if (!matches || busy) return;
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : `Não foi possível excluir o ${itemLabel}`,
      );
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-negative" />
            Excluir {itemLabel}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {description ?? (
              <>
                Esta ação é permanente e não pode ser desfeita. O {itemLabel}{" "}
                <span className="font-semibold text-foreground">{itemName}</span> será removido.
              </>
            )}
          </p>

          {consequences && consequences.length > 0 && (
            <ul className="space-y-1 rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
              {consequences.map((line) => (
                <li key={line} className="flex gap-2">
                  <span aria-hidden>•</span>
                  <span>{line}</span>
                </li>
              ))}
            </ul>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="confirm-delete-name">
              Digite <span className="font-mono font-semibold text-foreground">{itemName}</span>{" "}
              para confirmar
            </Label>
            <Input
              id="confirm-delete-name"
              autoFocus
              autoComplete="off"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void confirm()}
              placeholder={itemName}
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancelar
          </Button>
          <Button
            variant="destructive"
            onClick={confirm}
            disabled={!matches || busy}
            title={matches ? undefined : `Digite o nome do ${itemLabel} para liberar`}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

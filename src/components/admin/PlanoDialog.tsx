import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { KeyRound } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { DateField } from "@/components/ui/date-field";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  definirPlanoAdmin,
  lerHistoricoAdmin,
  reenviarAcessoAdmin,
  type UsuarioAdmin,
} from "@/lib/admin.functions";
import { ROTULO_ORIGEM, ROTULO_STATUS, STATUS_PLANO, type StatusPlano } from "@/lib/plano";

const SELECT_CLASS =
  "h-11 w-full rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none " +
  "transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

/**
 * Ajuste manual do plano de uma pessoa.
 *
 * É por aqui que sai a cortesia, e é por isso que o campo "motivo" não é
 * enfeite: seis meses depois, uma linha de histórico dizendo apenas "cortesia"
 * não distingue um acordo comercial de um engano. O texto vai para
 * `plano_historico` junto de quem clicou.
 *
 * O atalho de cortesia preenche os três campos de uma vez porque essa é a
 * operação real do dia a dia — "libera fulano por 3 meses" — e fazê-la em três
 * campos separados é onde se erra a data.
 */
export function PlanoDialog({
  usuario,
  onClose,
}: {
  usuario: UsuarioAdmin | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<StatusPlano>("cortesia");
  const [codigoOferta, setCodigoOferta] = useState("");
  const [expiraEm, setExpiraEm] = useState("");
  const [motivo, setMotivo] = useState("");

  useEffect(() => {
    if (!usuario) return;
    setStatus(usuario.status_plano);
    setCodigoOferta(usuario.codigo_oferta ?? "");
    setExpiraEm(paraISO(usuario.plano_expira_em));
    setMotivo("");
  }, [usuario]);

  const historico = useQuery({
    queryKey: ["admin", "historico", usuario?.id],
    queryFn: () => lerHistoricoAdmin({ data: { userId: usuario!.id } }),
    enabled: !!usuario,
  });

  const reenviar = useMutation({
    mutationFn: () => reenviarAcessoAdmin({ data: { userId: usuario!.id } }),
    onSuccess: (resultado) => {
      (resultado.ok ? toast.success : toast.error)(resultado.detalhe, { duration: 10_000 });
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível reenviar"),
  });

  const salvar = useMutation({
    mutationFn: () =>
      definirPlanoAdmin({
        data: {
          userId: usuario!.id,
          status,
          codigoOferta,
          expiraEm,
          motivo,
        },
      }),
    onSuccess: () => {
      toast.success("Plano atualizado");
      qc.invalidateQueries({ queryKey: ["admin"] });
      onClose();
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar"),
  });

  function cortesia(meses: number) {
    const fim = new Date();
    fim.setMonth(fim.getMonth() + meses);
    setStatus("cortesia");
    setExpiraEm(paraISO(fim));
    setMotivo((atual) => atual || `Cortesia de ${meses} ${meses === 1 ? "mês" : "meses"}`);
  }

  return (
    <Dialog open={!!usuario} onOpenChange={(aberto) => !aberto && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Gerenciar assinatura</DialogTitle>
          <DialogDescription>
            {usuario?.email}
            {usuario?.cakto_subscription_id ? (
              <>
                {" · "}
                <span className="font-mono text-xs">{usuario.cakto_subscription_id}</span>
              </>
            ) : null}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => cortesia(1)}>
              Cortesia 1 mês
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => cortesia(3)}>
              Cortesia 3 meses
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => cortesia(12)}>
              Cortesia 1 ano
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => {
                setStatus("cortesia");
                setExpiraEm("");
                setMotivo((atual) => atual || "Cortesia sem prazo");
              }}
            >
              Cortesia sem prazo
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plano-status">Status</Label>
            <select
              id="plano-status"
              className={SELECT_CLASS}
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusPlano)}
            >
              {STATUS_PLANO.map((s) => (
                <option key={s} value={s}>
                  {ROTULO_STATUS[s]}
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="plano-oferta">Código da oferta</Label>
              <Input
                id="plano-oferta"
                value={codigoOferta}
                onChange={(e) => setCodigoOferta(e.target.value)}
                placeholder="Ex.: 3rkj8mp"
                className="font-mono"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="plano-expira">Expira em</Label>
              <DateField
                id="plano-expira"
                value={expiraEm}
                onChange={(e) => setExpiraEm(e.target.value)}
                className="h-11 w-full"
              />
              <p className="text-[11px] text-muted-foreground">Em branco = sem prazo.</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="plano-motivo">Motivo</Label>
            <Textarea
              id="plano-motivo"
              value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Por que este ajuste? Fica registrado no histórico."
              rows={2}
            />
          </div>

          {/* A próxima renovação da Cakto sobrescreve o ajuste manual: o estado
              gravado é sempre o do último evento, e o webhook não sabe que
              alguém mexeu na mão. Dizer isso aqui evita a descoberta pelo
              suporte. */}
          <p className="rounded-xl border border-border bg-muted/40 p-3 text-[11px] leading-relaxed text-muted-foreground">
            Ajuste manual vale até o próximo evento da Cakto para esta pessoa — uma renovação ou um
            cancelamento sobrescreve o que for definido aqui. Para cortesia permanente, use uma
            conta que não tenha assinatura ativa na Cakto.
          </p>

          {!!historico.data?.length && (
            <div className="space-y-2">
              <p className="label-caps">Histórico</p>
              <ul className="space-y-1.5 text-xs">
                {historico.data.map((h) => (
                  <li key={h.id} className="flex flex-wrap gap-x-2 text-muted-foreground">
                    <span className="font-mono">
                      {new Date(h.created_at).toLocaleString("pt-BR")}
                    </span>
                    <span className="text-foreground">
                      {h.de_status ? `${ROTULO_STATUS[h.de_status]} → ` : ""}
                      {ROTULO_STATUS[h.para_status]}
                    </span>
                    <span>({ROTULO_ORIGEM[h.origem]})</span>
                    {h.ator_email && <span>por {h.ator_email}</span>}
                    {h.motivo && <span className="w-full italic">“{h.motivo}”</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <DialogFooter className="sm:justify-between">
          {/* Fica no rodapé, longe dos campos de plano, porque não é um ajuste
              de assinatura: é a saída para quando o e-mail da compra não
              chegou. Sai daqui uma senha nova — a anterior deixa de valer. */}
          <Button
            variant="outline"
            onClick={() => reenviar.mutate()}
            disabled={reenviar.isPending}
            title="Gera uma senha provisória nova e manda por e-mail"
          >
            <KeyRound className="size-4" />
            {reenviar.isPending ? "Enviando…" : "Reenviar acesso"}
          </Button>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              Cancelar
            </Button>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>
              {salvar.isPending ? "Salvando…" : "Salvar"}
            </Button>
          </span>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Data no formato do campo (YYYY-MM-DD), no fuso local. */
function paraISO(valor: Date | string | null): string {
  if (!valor) return "";
  const data = valor instanceof Date ? valor : new Date(valor);
  if (Number.isNaN(data.getTime())) return "";
  const mes = String(data.getMonth() + 1).padStart(2, "0");
  const dia = String(data.getDate()).padStart(2, "0");
  return `${data.getFullYear()}-${mes}-${dia}`;
}

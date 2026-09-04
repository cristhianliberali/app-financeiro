import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { KeyRound, PlugZap, Search, ShieldCheck, SlidersHorizontal } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { PlanoDialog } from "@/components/admin/PlanoDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  definirSuperAdminAdmin,
  lerMetricasAdmin,
  listarUsuariosAdmin,
  testarConexaoCakto,
  type UsuarioAdmin,
} from "@/lib/admin.functions";
import { ROTULO_STATUS, STATUS_PLANO, type StatusPlano } from "@/lib/plano";

export const Route = createFileRoute("/admin/")({
  head: () => ({
    meta: [{ title: "Usuários — Super admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminUsuariosPage,
});

const SELECT_CLASS =
  "h-11 rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none " +
  "transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

/** Tom do selo por status. Verde é acesso; vermelho é fim de linha. */
const TOM_STATUS: Record<StatusPlano, string> = {
  ativo: "border-positive/30 bg-positive-soft text-positive-soft-foreground",
  trial: "border-info/30 bg-info-soft text-info-soft-foreground",
  cortesia: "border-primary/30 bg-primary-soft text-primary-soft-foreground",
  atrasado: "border-warning/35 bg-warning-soft text-warning-soft-foreground",
  pausado: "border-warning/35 bg-warning-soft text-warning-soft-foreground",
  cancelado: "border-border bg-muted text-muted-foreground",
  reembolsado: "border-border bg-muted text-muted-foreground",
  chargeback: "border-destructive/30 bg-destructive/10 text-destructive",
  sem_assinatura: "border-border bg-muted text-muted-foreground",
};

function AdminUsuariosPage() {
  const qc = useQueryClient();
  const [busca, setBusca] = useState("");
  const [buscaAplicada, setBuscaAplicada] = useState("");
  const [status, setStatus] = useState<string>("todos");
  const [pagina, setPagina] = useState(1);
  const [emEdicao, setEmEdicao] = useState<UsuarioAdmin | null>(null);

  const metricas = useQuery({
    queryKey: ["admin", "metricas"],
    queryFn: () => lerMetricasAdmin(),
  });

  const usuarios = useQuery({
    queryKey: ["admin", "usuarios", buscaAplicada, status, pagina],
    queryFn: () => listarUsuariosAdmin({ data: { busca: buscaAplicada, status, pagina } }),
  });

  const alternarAdmin = useMutation({
    mutationFn: (input: { userId: string; valor: boolean }) =>
      definirSuperAdminAdmin({ data: input }),
    onSuccess: () => {
      toast.success("Permissão atualizada");
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Não foi possível"),
  });

  const testar = useMutation({
    mutationFn: () => testarConexaoCakto(),
    onSuccess: (resultado) => {
      if (resultado.ok) {
        toast.success(resultado.mensagem, {
          description: resultado.webhooks.map((w) => w.url).join("\n") || undefined,
          duration: 12_000,
        });
      } else {
        toast.error(resultado.mensagem, { duration: 12_000 });
      }
    },
  });

  const total = usuarios.data?.total ?? 0;
  const porPagina = usuarios.data?.porPagina ?? 25;
  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <AdminShell titulo="Usuários e assinaturas">
      {/* Estado da integração antes de qualquer número: um painel que mostra
          "0 ativos" sem dizer que o webhook não está configurado leva a
          conclusão errada sobre o negócio. */}
      {metricas.data && !metricas.data.caktoConfigurada && (
        <p className="rounded-xl border border-warning/35 bg-warning-soft p-4 text-sm text-warning-soft-foreground">
          <strong>Cakto não configurada.</strong> Defina{" "}
          <code className="font-mono">CAKTO_WEBHOOK_SECRET</code> no serviço e aponte o webhook do
          painel da Cakto para <code className="font-mono">/api/cakto/webhook</code>. Enquanto isso,
          nenhum status chega sozinho.
        </p>
      )}
      {metricas.data?.caktoConfigurada && !metricas.data.exigindoAssinatura && (
        <p className="rounded-xl border border-info/30 bg-info-soft p-4 text-sm text-info-soft-foreground">
          <strong>Trava de acesso desligada.</strong> Os webhooks estão sendo recebidos e os status
          gravados, mas o app segue aberto para todo mundo. Quando os números abaixo baterem com a
          realidade, ligue <code className="font-mono">CAKTO_EXIGIR_ASSINATURA=true</code>.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica titulo="Com acesso" valor={metricas.data?.liberados} destaque />
        <Metrica titulo="Usuários no total" valor={metricas.data?.total} />
        <Metrica titulo="Novos em 7 dias" valor={metricas.data?.novosNaSemana} />
        <Metrica
          titulo="Eventos a revisar"
          valor={metricas.data?.eventosComProblema}
          alerta={(metricas.data?.eventosComProblema ?? 0) > 0}
        />
      </div>

      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setPagina(1);
            setBuscaAplicada(busca);
          }}
        >
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar por e-mail ou nome"
              className="w-64 pl-9"
            />
          </div>
          <select
            className={SELECT_CLASS}
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPagina(1);
            }}
          >
            <option value="todos">Todos os status</option>
            {STATUS_PLANO.map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS[s]}
              </option>
            ))}
          </select>
          <Button type="submit" variant="outline">
            <SlidersHorizontal className="size-4" /> Filtrar
          </Button>
        </form>

        <Button variant="outline" onClick={() => testar.mutate()} disabled={testar.isPending}>
          <PlugZap className="size-4" />
          {testar.isPending ? "Testando…" : "Testar conexão com a Cakto"}
        </Button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-border bg-card">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="border-b border-border text-left">
            <tr className="label-caps [&>th]:px-4 [&>th]:py-3">
              <th>Usuário</th>
              <th>Status</th>
              <th>Oferta</th>
              <th>Renova / expira</th>
              <th>Origem</th>
              <th>Último acesso</th>
              <th className="text-right">Ações</th>
            </tr>
          </thead>
          <tbody>
            {usuarios.isPending && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  Carregando…
                </td>
              </tr>
            )}
            {usuarios.data?.itens.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-muted-foreground">
                  Nenhum usuário com esse filtro.
                </td>
              </tr>
            )}
            {usuarios.data?.itens.map((u) => (
              <tr
                key={u.id}
                className="border-b border-border last:border-0 [&>td]:px-4 [&>td]:py-3"
              >
                <td>
                  <div className="flex min-w-0 flex-col">
                    <span className="flex items-center gap-1.5 truncate font-medium">
                      {u.full_name || "—"}
                      {u.is_super_admin && (
                        <ShieldCheck
                          className="size-3.5 shrink-0 text-primary"
                          aria-label="Super admin"
                        />
                      )}
                      {/* Senha provisória parada numa caixa de entrada é a
                          pendência que ninguém descobre sem alguém poder ver. */}
                      {u.senha_provisoria && (
                        <KeyRound
                          className="size-3.5 shrink-0 text-warning"
                          aria-label="Ainda usa a senha provisória enviada por e-mail"
                        />
                      )}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{u.email}</span>
                  </div>
                </td>
                <td>
                  <span
                    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${TOM_STATUS[u.status_plano]}`}
                  >
                    {ROTULO_STATUS[u.status_plano]}
                  </span>
                </td>
                <td className="font-mono text-xs">{u.codigo_oferta || "—"}</td>
                <td className="text-xs">{dataCurta(u.plano_expira_em)}</td>
                <td className="text-xs text-muted-foreground">{u.plano_origem ?? "—"}</td>
                <td className="text-xs text-muted-foreground">{dataCurta(u.ultimo_acesso)}</td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="outline" onClick={() => setEmEdicao(u)}>
                      Gerenciar
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() =>
                        alternarAdmin.mutate({ userId: u.id, valor: !u.is_super_admin })
                      }
                      title={u.is_super_admin ? "Remover super admin" : "Tornar super admin"}
                    >
                      <ShieldCheck
                        className={`size-4 ${u.is_super_admin ? "text-primary" : "text-muted-foreground"}`}
                      />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {total} usuário{total === 1 ? "" : "s"}
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pagina <= 1}
            onClick={() => setPagina((p) => p - 1)}
          >
            Anterior
          </Button>
          <span>
            {pagina} de {paginas}
          </span>
          <Button
            size="sm"
            variant="outline"
            disabled={pagina >= paginas}
            onClick={() => setPagina((p) => p + 1)}
          >
            Próxima
          </Button>
        </div>
      </div>

      <PlanoDialog usuario={emEdicao} onClose={() => setEmEdicao(null)} />
    </AdminShell>
  );
}

function Metrica({
  titulo,
  valor,
  destaque,
  alerta,
}: {
  titulo: string;
  valor: number | undefined;
  destaque?: boolean;
  alerta?: boolean;
}) {
  return (
    <div
      className={`rounded-2xl border p-4 ${
        alerta ? "border-warning/35 bg-warning-soft" : "border-border bg-card"
      }`}
    >
      <p className="label-caps">{titulo}</p>
      <p className={`mt-1 text-2xl font-bold ${destaque ? "text-primary" : ""}`}>{valor ?? "—"}</p>
    </div>
  );
}

function dataCurta(valor: Date | string | null): string {
  if (!valor) return "—";
  const data = valor instanceof Date ? valor : new Date(valor);
  return Number.isNaN(data.getTime()) ? "—" : data.toLocaleDateString("pt-BR");
}

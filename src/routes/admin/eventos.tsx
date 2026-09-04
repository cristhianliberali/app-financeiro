import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react";

import { AdminShell } from "@/components/admin/AdminShell";
import { Button } from "@/components/ui/button";
import { listarEventosAdmin, reprocessarEventoAdmin } from "@/lib/admin.functions";

export const Route = createFileRoute("/admin/eventos")({
  head: () => ({
    meta: [{ title: "Eventos da Cakto — Super admin" }, { name: "robots", content: "noindex" }],
  }),
  component: AdminEventosPage,
});

const SELECT_CLASS =
  "h-11 rounded-xl border border-input bg-card px-3 text-sm font-medium shadow-xs outline-none " +
  "transition-colors hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25";

const SITUACOES = [
  { valor: "todos", rotulo: "Todas as situações" },
  { valor: "aplicado", rotulo: "Aplicados" },
  { valor: "sem_usuario", rotulo: "Sem conta correspondente" },
  { valor: "ignorado", rotulo: "Ignorados" },
  { valor: "erro", rotulo: "Com erro" },
  { valor: "pendente", rotulo: "Pendentes" },
] as const;

const TOM_SITUACAO: Record<string, string> = {
  aplicado: "border-positive/30 bg-positive-soft text-positive-soft-foreground",
  sem_usuario: "border-warning/35 bg-warning-soft text-warning-soft-foreground",
  ignorado: "border-border bg-muted text-muted-foreground",
  erro: "border-destructive/30 bg-destructive/10 text-destructive",
  pendente: "border-info/30 bg-info-soft text-info-soft-foreground",
};

/**
 * Tudo o que a Cakto mandou, cru.
 *
 * Esta tela é a razão de o corpo dos webhooks ser guardado antes de
 * interpretado. Ela responde as três perguntas que aparecem quando alguém diz
 * "paguei e não liberou": o evento chegou? Achamos a pessoa? O que exatamente
 * veio no corpo? E o botão de reprocessar fecha o ciclo — corrigido o
 * mapeamento (ou criada a conta que faltava), o mesmo evento é aplicado de
 * novo, sem depender de reenvio da Cakto.
 */
function AdminEventosPage() {
  const qc = useQueryClient();
  const [situacao, setSituacao] = useState<string>("todos");
  const [pagina, setPagina] = useState(1);
  const [aberto, setAberto] = useState<string | null>(null);

  const eventos = useQuery({
    queryKey: ["admin", "eventos", situacao, pagina],
    queryFn: () => listarEventosAdmin({ data: { situacao, pagina } }),
  });

  const reprocessar = useMutation({
    mutationFn: (eventoId: string) => reprocessarEventoAdmin({ data: { eventoId } }),
    onSuccess: (resultado) => {
      const aviso = resultado.situacao === "aplicado" ? toast.success : toast.info;
      aviso(resultado.detalhe);
      qc.invalidateQueries({ queryKey: ["admin"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "Não foi possível reprocessar"),
  });

  const total = eventos.data?.total ?? 0;
  const porPagina = eventos.data?.porPagina ?? 20;
  const paginas = Math.max(1, Math.ceil(total / porPagina));

  return (
    <AdminShell titulo="Eventos recebidos da Cakto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <select
          className={SELECT_CLASS}
          value={situacao}
          onChange={(e) => {
            setSituacao(e.target.value);
            setPagina(1);
          }}
        >
          {SITUACOES.map((s) => (
            <option key={s.valor} value={s.valor}>
              {s.rotulo}
            </option>
          ))}
        </select>
        <Button variant="outline" onClick={() => eventos.refetch()} disabled={eventos.isFetching}>
          <RefreshCw className={`size-4 ${eventos.isFetching ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      <div className="space-y-2">
        {eventos.isPending && (
          <p className="rounded-2xl border border-border bg-card p-10 text-center text-sm text-muted-foreground">
            Carregando…
          </p>
        )}

        {eventos.data?.itens.length === 0 && (
          <div className="rounded-2xl border border-border bg-card p-10 text-center">
            <p className="text-sm font-medium">Nenhum evento por aqui.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Se já houve compras, confira no painel da Cakto se o webhook aponta para{" "}
              <code className="font-mono">/api/cakto/webhook</code> deste domínio.
            </p>
          </div>
        )}

        {eventos.data?.itens.map((evento) => {
          const expandido = aberto === evento.id;
          return (
            <div
              key={evento.id}
              className="overflow-hidden rounded-2xl border border-border bg-card"
            >
              <div className="flex flex-wrap items-center gap-3 p-4">
                <button
                  onClick={() => setAberto(expandido ? null : evento.id)}
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  {expandido ? (
                    <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{evento.evento}</span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                          TOM_SITUACAO[evento.situacao] ?? "border-border bg-muted"
                        }`}
                      >
                        {evento.situacao}
                      </span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {new Date(evento.recebido_em).toLocaleString("pt-BR")}
                      {evento.email ? ` · ${evento.email}` : ""}
                      {evento.codigo_oferta ? ` · oferta ${evento.codigo_oferta}` : ""}
                    </p>
                    {evento.detalhe && (
                      <p className="mt-0.5 text-xs text-muted-foreground">{evento.detalhe}</p>
                    )}
                  </div>
                </button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => reprocessar.mutate(evento.id)}
                  disabled={reprocessar.isPending}
                >
                  Reprocessar
                </Button>
              </div>

              {expandido && (
                <pre className="max-h-96 overflow-auto border-t border-border bg-muted/40 p-4 text-[11px] leading-relaxed">
                  {JSON.stringify(evento.payload, null, 2)}
                </pre>
              )}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
        <span>
          {total} evento{total === 1 ? "" : "s"}
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
    </AdminShell>
  );
}

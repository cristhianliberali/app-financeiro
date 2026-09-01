import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  FileScan,
  FileUp,
  Sparkles,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppState } from "@/lib/app-state";
import { activeCategories, useCategories, useUpsert } from "@/lib/data";
import {
  ACCEPTED_UPLOAD,
  extractDocument,
  type ExtracaoParaTela,
  type TransacaoExtraida,
} from "@/lib/document-import.functions";
import { brl, formatDateBR } from "@/lib/format";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

/** Uma transação extraída, com o que a tela deixa ajustar antes de lançar. */
type Draft = TransacaoExtraida & {
  include: boolean;
  category_id: string;
  /** Data editável; nasce da `dataIso` que o parser resolveu. */
  data: string;
};

const ORIGEM_LABEL: Record<ExtracaoParaTela["origem"], string> = {
  pdf_texto: "PDF",
  ocr: "OCR",
  csv: "CSV",
  ofx: "OFX",
  texto: "texto",
};

/** Lê o arquivo escolhido como base64, sem o prefixo `data:`. */
function readAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("Não foi possível ler o arquivo"));
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.readAsDataURL(file);
  });
}

/**
 * Importação de fatura/extrato em duas etapas.
 *
 * Etapa 1 (esta tela): o servidor extrai as transações por código e devolve
 * tudo de uma vez — nenhum dado do documento vai para IA. Etapa 2 (botão
 * "Categorizar com IA"): só as descrições numeradas e as categorias
 * disponíveis vão para o modelo, que devolve decisões.
 */
export function DocumentImportDialog({ open, onOpenChange }: Props) {
  const { profileId } = useAppState();
  const { data: allCategories = [] } = useCategories(profileId);
  const categories = useMemo(() => activeCategories(allCategories), [allCategories]);
  const upsert = useUpsert("transactions");
  const extract = useServerFn(extractDocument);
  const fileInput = useRef<HTMLInputElement>(null);

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [extracao, setExtracao] = useState<ExtracaoParaTela | null>(null);
  const [rows, setRows] = useState<Draft[]>([]);
  /** Vencimento único do documento, aplicado a todas as linhas ao lançar. */
  const [vencimento, setVencimento] = useState("");
  const [showTotais, setShowTotais] = useState(false);
  const [showNaoInterpretadas, setShowNaoInterpretadas] = useState(false);

  useEffect(() => {
    if (open) return;
    setText("");
    setFile(null);
    setExtracao(null);
    setRows([]);
    setVencimento("");
    setShowTotais(false);
    setShowNaoInterpretadas(false);
  }, [open]);

  /** Uma chamada só: o documento inteiro vira transações de uma vez. */
  async function start() {
    if (!profileId) return;
    setLoading(true);
    try {
      const resultado = await extract({
        data: {
          profileId,
          ...(file ? { file: { name: file.name, base64: await readAsBase64(file) } } : { text }),
        },
      });
      setExtracao(resultado);
      setVencimento(resultado.vencimento ?? "");
      setRows(
        resultado.transacoes.map((t) => ({
          ...t,
          include: true,
          category_id: "",
          data: t.dataIso ?? "",
        })),
      );
      if (resultado.transacoes.length === 0) {
        toast.warning("Nenhuma transação com data e valor foi encontrada no documento.");
      } else {
        toast.success(
          `${resultado.transacoes.length} transações encontradas` +
            (resultado.conferencia.disponivel
              ? resultado.conferencia.fechouTudo
                ? " — os totais do documento conferem"
                : " — atenção: nem todos os totais fecharam"
              : ""),
        );
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao ler o documento");
    } finally {
      setLoading(false);
    }
  }

  function patch(linhaId: number, values: Partial<Draft>) {
    setRows((prev) => prev.map((r) => (r.linhaId === linhaId ? { ...r, ...values } : r)));
  }

  async function commit() {
    const selected = rows.filter((r) => r.include);
    if (!selected.length) {
      toast.error("Selecione ao menos uma transação");
      return;
    }
    const semData = selected.filter((r) => !r.data);
    if (semData.length > 0) {
      toast.error(
        semData.length === 1
          ? "1 transação selecionada está sem data. Preencha antes de lançar."
          : `${semData.length} transações selecionadas estão sem data. Preencha antes de lançar.`,
      );
      return;
    }
    await upsert.mutateAsync(
      selected.map((r) => ({
        profile_id: profileId,
        description: r.parcela
          ? `${r.descricao} ${r.parcela.numero}/${r.parcela.total}`
          : r.descricao,
        amount: r.valor,
        kind: r.kind,
        transaction_date: r.data,
        due_date: vencimento || r.data,
        status: "pending",
        category_id: r.category_id || null,
        installment_no: r.parcela?.numero ?? null,
        installment_total: r.parcela?.total ?? null,
        installment_group: r.parcela ? crypto.randomUUID() : null,
      })),
    );
    toast.success(`${selected.length} transações lançadas`);
    onOpenChange(false);
  }

  const selected = rows.filter((r) => r.include);
  const totals = selected.reduce(
    (acc, row) => {
      if (row.kind === "income") acc.income += row.valor;
      else acc.expense += row.valor;
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const comAviso = rows.filter((r) => r.avisos.length > 0).length;
  // Só os totais conferíveis entram no veredito; limite, taxa e projeção são
  // declarações do documento, não somas das linhas.
  const conferiveis = extracao?.conferencia.totais.filter((t) => t.conferivel) ?? [];
  const informativos = (extracao?.conferencia.totais.length ?? 0) - conferiveis.length;
  const totaisAbertos = conferiveis.filter((t) => !t.fechou);
  const canStart = !!file || text.trim().length >= 10;

  // Agrupado como no documento: cada portador/seção vira um cabeçalho de bloco.
  const grupos = useMemo(() => {
    const lista: Array<{ grupo: string | null; itens: Draft[] }> = [];
    for (const row of rows) {
      const atual = lista[lista.length - 1];
      if (atual && atual.grupo === row.grupo) atual.itens.push(row);
      else lista.push({ grupo: row.grupo, itens: [row] });
    }
    return lista;
  }, [rows]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileScan className="size-4 text-primary" /> Importar fatura ou extrato
          </DialogTitle>
        </DialogHeader>

        {!extracao ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Anexar arquivo</Label>
              <input
                ref={fileInput}
                type="file"
                accept={ACCEPTED_UPLOAD}
                className="hidden"
                onChange={(e) => {
                  const chosen = e.target.files?.[0] ?? null;
                  setFile(chosen);
                  if (chosen) setText("");
                }}
              />
              {file ? (
                <div className="flex items-center gap-2 rounded-lg border border-border p-2.5 text-sm">
                  <FileUp className="size-4 shrink-0 text-primary" />
                  <span className="truncate">{file.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    {(file.size / 1024).toFixed(0)} KB
                  </span>
                  <button
                    onClick={() => {
                      setFile(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                    className="text-muted-foreground transition-colors hover:text-destructive"
                    aria-label="Remover arquivo"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => fileInput.current?.click()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground transition-colors hover:border-primary hover:text-foreground"
                >
                  <FileUp className="size-4" /> PDF, OFX, CSV, Word, Excel ou TXT
                </button>
              )}
            </div>

            <div className="space-y-2">
              <Label>Ou cole o texto da fatura</Label>
              <Textarea
                rows={8}
                value={text}
                disabled={!!file}
                onChange={(e) => setText(e.target.value)}
                placeholder={
                  "01/03  UBER TRIP           R$ 24,90\n02/03  MERCADO XPTO 2/5     R$ 189,00"
                }
                className="font-mono text-xs"
              />
            </div>

            <p className="text-xs text-muted-foreground">
              A leitura é feita pelo próprio app, sem IA: as transações aparecem todas de uma vez e
              são conferidas contra os totais que o documento declara. A categorização com IA é uma
              etapa separada, depois da conferência — nada do arquivo é enviado nesta etapa.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">
              {ORIGEM_LABEL[extracao.origem]}
              {extracao.estatisticas.paginas > 1 &&
                ` · ${extracao.estatisticas.paginas} páginas`} · {extracao.estatisticas.linhas}{" "}
              linhas lidas · {rows.length} transações
              {extracao.periodo.inicio &&
                extracao.periodo.fim &&
                ` · período ${formatDateBR(extracao.periodo.inicio)} a ${formatDateBR(extracao.periodo.fim)}`}
            </p>

            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold">Resumo da extração</p>
                <p className="text-[11px] text-muted-foreground">
                  {selected.length} de {rows.length} selecionada{rows.length === 1 ? "" : "s"} para
                  lançar
                </p>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-center">
                <div className="rounded-lg bg-card p-2">
                  <p className="label-caps text-[10px]">Entradas</p>
                  <p className="font-mono text-sm font-bold text-positive">{brl(totals.income)}</p>
                </div>
                <div className="rounded-lg bg-card p-2">
                  <p className="label-caps text-[10px]">Saídas</p>
                  <p className="font-mono text-sm font-bold text-negative">{brl(totals.expense)}</p>
                </div>
                <div className="rounded-lg bg-card p-2">
                  <p className="label-caps text-[10px]">Resultado</p>
                  <p className="font-mono text-sm font-bold">
                    {brl(totals.income - totals.expense)}
                  </p>
                </div>
              </div>
            </div>

            {/* Conferência contra os checksums do próprio documento. */}
            {extracao.conferencia.disponivel ? (
              <div
                className={`rounded-xl border p-3 text-xs ${
                  extracao.conferencia.fechouTudo
                    ? "border-positive/40 bg-positive/5"
                    : "border-negative/40 bg-negative/5"
                }`}
              >
                <button
                  onClick={() => setShowTotais((v) => !v)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  {extracao.conferencia.fechouTudo ? (
                    <CheckCircle2 className="size-4 shrink-0 text-positive" />
                  ) : (
                    <AlertTriangle className="size-4 shrink-0 text-negative" />
                  )}
                  <span className="flex-1">
                    {extracao.conferencia.fechouTudo
                      ? conferiveis.length === 1
                        ? "Conferência bateu: o total declarado no documento confere com as transações extraídas."
                        : `Conferência bateu: os ${conferiveis.length} totais declarados no documento conferem com as transações extraídas.`
                      : `${totaisAbertos.length} de ${conferiveis.length} totais declarados no documento não fecharam. Confira as linhas destacadas antes de lançar.`}
                  </span>
                  {showTotais ? (
                    <ChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )}
                </button>
                {showTotais && (
                  <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                    {conferiveis.map((total) => (
                      <li key={total.linhaId} className="flex items-center gap-2">
                        {total.fechou ? (
                          <CheckCircle2 className="size-3 shrink-0 text-positive" />
                        ) : (
                          <AlertTriangle className="size-3 shrink-0 text-negative" />
                        )}
                        <span className="flex-1 truncate">{total.rotulo}</span>
                        <span className="font-mono">{brl(total.valor)}</span>
                        {!total.fechou && (
                          <span className="font-mono text-negative">
                            (faltam {brl(Math.abs(total.diferenca))})
                          </span>
                        )}
                      </li>
                    ))}
                    {informativos > 0 && (
                      <li className="pt-1 text-muted-foreground">
                        {informativos === 1
                          ? "1 outro valor declarado (limite, taxa, mínimo ou projeção) fica fora da conferência."
                          : `${informativos} outros valores declarados (limites, taxas, mínimos e projeções) ficam fora da conferência.`}
                      </li>
                    )}
                  </ul>
                )}
              </div>
            ) : (
              <p className="rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
                O documento não declara totais, então a conferência de soma não se aplica. Confira
                as transações uma a uma antes de lançar.
              </p>
            )}

            {extracao.conferencia.alertas.map((alerta, i) => (
              <p
                key={i}
                className="flex items-center gap-2 rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs"
              >
                <AlertTriangle className="size-4 shrink-0 text-negative" />
                {alerta.mensagem}
              </p>
            ))}

            {extracao.naoInterpretadas.length > 0 && (
              <div className="rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <button
                  onClick={() => setShowNaoInterpretadas((v) => !v)}
                  className="flex w-full items-center gap-2 text-left"
                >
                  <span className="flex-1">
                    {extracao.naoInterpretadas.length === 1
                      ? "1 linha do documento não foi interpretada."
                      : `${extracao.naoInterpretadas.length} linhas do documento não foram interpretadas.`}{" "}
                    Nenhuma delas tem data e valor de transação.
                  </span>
                  {showNaoInterpretadas ? (
                    <ChevronDown className="size-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="size-3.5 shrink-0" />
                  )}
                </button>
                {showNaoInterpretadas && (
                  <ul className="mt-2 space-y-0.5 border-t border-border/60 pt-2 font-mono text-[11px]">
                    {extracao.naoInterpretadas.map((linha) => (
                      <li key={linha.linhaId} className="truncate">
                        {linha.texto}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-2.5 text-xs">
              <Label className="text-xs">Vencimento</Label>
              <DateField
                type="date"
                className="h-8 w-40 text-xs"
                value={vencimento}
                onChange={(e) => setVencimento(e.target.value)}
                aria-label="Data de vencimento do documento"
              />
              <span className="text-muted-foreground">
                aplicado a todas as transações ao lançar; sem ele, vale a data de cada linha.
              </span>
            </div>

            <div className="grid grid-cols-12 gap-2 px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="col-span-1" />
              <span className="col-span-4">Descrição</span>
              <span className="col-span-2">Data</span>
              <span className="col-span-3">Categoria</span>
              <span className="col-span-2 text-right">Valor</span>
            </div>

            {grupos.map(({ grupo, itens }, gi) => (
              <div key={gi} className="space-y-2">
                {grupo && (
                  <p className="label-caps px-2 pt-1 text-[10px] text-muted-foreground">{grupo}</p>
                )}
                {itens.map((r) => (
                  <div
                    key={r.linhaId}
                    className={`grid grid-cols-12 items-center gap-2 rounded-xl border p-2 ${
                      r.avisos.length > 0 ? "border-negative/50 bg-negative/5" : "border-border"
                    }`}
                  >
                    <Checkbox
                      checked={r.include}
                      onCheckedChange={(checked) => patch(r.linhaId, { include: checked === true })}
                      className="col-span-1"
                      aria-label="Incluir transação"
                    />
                    <div className="col-span-4 space-y-1">
                      <Input
                        className="h-8 text-xs"
                        value={r.descricao}
                        onChange={(e) => patch(r.linhaId, { descricao: e.target.value })}
                      />
                      <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        {r.parcela && (
                          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                            {r.parcela.numero}/{r.parcela.total}
                          </span>
                        )}
                        {r.estorno && (
                          <span className="flex items-center gap-1 rounded bg-positive/10 px-1.5 py-0.5 text-positive">
                            <Undo2 className="size-3" /> estorno
                          </span>
                        )}
                        {r.dataRaw && r.data !== r.dataIso && (
                          <span title="Data alterada; no documento está assim">
                            no documento: {r.dataRaw}
                          </span>
                        )}
                        {r.avisos.includes("orfao") && (
                          <span
                            className="flex items-center gap-1 text-negative"
                            title="Esta transação não soma em nenhum total declarado que fechou. Confira o documento."
                          >
                            <AlertTriangle className="size-3" /> fora dos totais
                          </span>
                        )}
                        {r.avisos.includes("sanidade") && (
                          <span
                            className="flex items-center gap-1 text-negative"
                            title="Um validador apontou esta linha (data fora do período ou valor fora do esperado)."
                          >
                            <AlertTriangle className="size-3" /> conferir
                          </span>
                        )}
                      </span>
                    </div>
                    <DateField
                      type="date"
                      className="col-span-2 h-8 text-xs"
                      value={r.data}
                      onChange={(e) => patch(r.linhaId, { data: e.target.value })}
                      aria-label="Data da transação"
                    />
                    <select
                      className="col-span-3 h-8 rounded-md border border-input bg-card px-2 text-xs"
                      value={r.category_id}
                      onChange={(e) => patch(r.linhaId, { category_id: e.target.value })}
                    >
                      <option value="">Sem categoria</option>
                      {categories
                        .filter((c) => c.kind === r.kind)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                    </select>
                    <span
                      className={`col-span-2 text-right font-mono text-xs font-semibold ${
                        r.kind === "income" ? "text-positive" : "text-negative"
                      }`}
                    >
                      {r.kind === "income" ? "+" : "−"}
                      {brl(r.valor)}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            {comAviso > 0 && (
              <p className="px-2 text-[11px] text-muted-foreground">
                {comAviso === 1
                  ? "1 transação destacada merece conferência contra o documento."
                  : `${comAviso} transações destacadas merecem conferência contra o documento.`}
              </p>
            )}

            <button
              onClick={() => {
                setExtracao(null);
                setRows([]);
                setVencimento("");
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" /> Descartar leitura
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {!extracao ? (
            <Button onClick={start} disabled={loading || !canStart}>
              {loading ? "Lendo documento…" : "Ler documento"}
            </Button>
          ) : (
            <>
              <Button
                variant="outline"
                disabled
                title="Próxima etapa: envia só as descrições numeradas e as categorias para a IA decidir. Em breve."
              >
                <Sparkles className="size-4" /> Categorizar com IA
              </Button>
              <Button onClick={commit} disabled={upsert.isPending || loading}>
                Lançar selecionadas
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

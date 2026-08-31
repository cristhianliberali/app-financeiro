import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, CalendarPlus, FileUp, Sparkles, Trash2, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
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
  getImportConfig,
  prepareImport,
  processNextBatch,
  type ImportSummary,
  type ParsedRow,
} from "@/lib/ai-import.functions";
import { brl, formatDateBR } from "@/lib/format";

type Props = { open: boolean; onOpenChange: (v: boolean) => void };

type Draft = ParsedRow & { category_id: string; include: boolean };

/** As duas datas de um lançamento, que a edição em massa alcança. */
type DateField = "date" | "due_date";

const DATE_LABEL: Record<DateField, string> = {
  date: "data do lançamento",
  due_date: "data de vencimento",
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

export function AiImportDialog({ open, onOpenChange }: Props) {
  const { profileId } = useAppState();
  const { data: allCategories = [] } = useCategories(profileId);
  // A IA classifica só entre as categorias ativas — é o que o servidor manda no
  // prompt —, então o seletor da revisão oferece as mesmas.
  const categories = useMemo(() => activeCategories(allCategories), [allCategories]);
  const upsert = useUpsert("transactions");
  const prepare = useServerFn(prepareImport);
  const processBatch = useServerFn(processNextBatch);
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: config } = useQuery({
    queryKey: ["ai-import-config"],
    queryFn: () => getImportConfig(),
    staleTime: 5 * 60 * 1000,
  });

  const [text, setText] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [batchesDone, setBatchesDone] = useState(0);
  const [rows, setRows] = useState<Draft[]>([]);
  /** Conferência do servidor: o que foi recuperado e o que ficou sem lançamento. */
  const [coverage, setCoverage] = useState({
    recovered: 0,
    missing: 0,
    summaryRows: 0,
    projectedRows: 0,
  });
  /** As linhas que parecem total/resumo ficam recolhidas até se pedir para ver. */
  const [showSummaryRows, setShowSummaryRows] = useState(false);
  /** Última data mexida à mão, que abre a opção de repetir nas demais linhas. */
  const [lastDate, setLastDate] = useState<{ field: DateField; value: string } | null>(null);
  /** Campos em que "aplicar a todos" ficou marcado: seguem se repetindo sozinhos. */
  const [repeatDate, setRepeatDate] = useState<Record<DateField, boolean>>({
    date: false,
    due_date: false,
  });

  useEffect(() => {
    if (open) return;
    // Fechar o diálogo descarta o rascunho; o cache do servidor expira sozinho.
    setText("");
    setFile(null);
    setSummary(null);
    setBatchesDone(0);
    setRows([]);
    setCoverage({ recovered: 0, missing: 0, summaryRows: 0, projectedRows: 0 });
    setShowSummaryRows(false);
    setLastDate(null);
    setRepeatDate({ date: false, due_date: false });
  }, [open]);

  function toDraft(row: ParsedRow): Draft {
    return {
      ...row,
      // Duplicado e provável total nascem desmarcados: aparecem na lista para o
      // usuário ver o que foi reconhecido, mas não entram no lançamento em massa.
      include: !row.duplicateOf && !row.looksLikeSummary,
      category_id:
        categories.find(
          (c) => c.kind === row.kind && c.name.toLowerCase() === row.category.toLowerCase(),
        )?.id ?? "",
    };
  }

  /** Envia o documento, que é dividido em lotes, e já processa o primeiro. */
  async function start() {
    if (!profileId) return;
    setLoading(true);
    try {
      const prepared = await prepare({
        data: {
          profileId,
          ...(file ? { file: { name: file.name, base64: await readAsBase64(file) } } : { text }),
        },
      });
      setSummary(prepared);

      if (prepared.totalBatches > 1) {
        toast.info(
          `Documento dividido em ${prepared.totalBatches} lotes (${prepared.totalTokens.toLocaleString("pt-BR")} tokens). ` +
            `Processando o primeiro.`,
        );
      }
      await runBatch(prepared.importId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao preparar a importação");
    } finally {
      setLoading(false);
    }
  }

  /** Processa o próximo lote pendente — uma requisição de IA por clique. */
  async function runBatch(importId: string) {
    if (!profileId) return;
    setLoading(true);
    try {
      const result = await processBatch({ data: { importId, profileId } });
      setRows((prev) => [...prev, ...result.rows.map(toDraft)]);
      setBatchesDone(result.batchNumber);
      setCoverage((prev) => ({
        recovered: prev.recovered + result.recovered,
        missing: prev.missing + result.missing,
        summaryRows: prev.summaryRows + result.summaryRows,
        projectedRows: prev.projectedRows + result.projectedRows,
      }));
      if (result.rows.length === 0) {
        toast.warning(`Lote ${result.batchNumber} não trouxe lançamentos.`);
      } else {
        toast.success(
          result.totalBatches > 1
            ? `Lote ${result.batchNumber}/${result.totalBatches}: ${result.rows.length} lançamentos`
            : `${result.rows.length} lançamentos identificados`,
        );
      }
      if (result.done) setSummary((prev) => (prev ? { ...prev, importId: "" } : prev));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Falha ao processar o lote");
    } finally {
      setLoading(false);
    }
  }

  function patch(i: number, values: Partial<Draft>) {
    setRows((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...values } : r)));
  }

  /** Repete a data em todas as linhas — menos nas já lançadas, que não vão. */
  function applyDateToAll(field: DateField, value: string) {
    if (!value) return;
    setRows((prev) => prev.map((r) => (r.duplicateOf ? r : { ...r, [field]: value })));
  }

  /**
   * Mexer numa data oferece repetir nas demais: numa fatura de cartão o
   * vencimento é o mesmo para todas as linhas, e corrigi-lo uma a uma em cem
   * lançamentos não é trabalho para ninguém.
   */
  function patchDate(i: number, field: DateField, value: string) {
    patch(i, { [field]: value } as Partial<Draft>);
    if (repeatDate[field]) applyDateToAll(field, value);
    else if (value) setLastDate({ field, value });
  }

  async function commit() {
    const selected = rows.filter((r) => r.include && !r.duplicateOf);
    if (!selected.length) {
      toast.error("Selecione ao menos um lançamento");
      return;
    }
    await upsert.mutateAsync(
      selected.map((r) => ({
        profile_id: profileId,
        description: r.description,
        amount: r.amount,
        kind: r.kind,
        transaction_date: r.date,
        due_date: r.due_date || r.date,
        status: "pending",
        category_id: r.category_id || null,
        installment_no: r.installment_no,
        installment_total: r.installment_total,
        installment_group: r.installment_group,
      })),
    );
    toast.success(`${selected.length} lançamentos importados`);
    onOpenChange(false);
  }

  const pendingBatches = summary && summary.importId ? summary.totalBatches - batchesDone : 0;
  const unverified = rows.filter((r) => !r.amountFound && !r.duplicateOf).length;
  const duplicates = rows.filter((r) => r.duplicateOf).length;

  // As que parecem total/resumo saem da lista por padrão: são ruído até alguém
  // querer conferir uma por uma.
  const visibleRows = rows
    .map((row, index) => ({ row, index }))
    .filter(({ row }) => showSummaryRows || !row.looksLikeSummary);

  // Somado aqui, no código, e não pedido à IA: conferir a extração com um número
  // que a própria IA produziu não conferiria nada.
  const selected = rows.filter((r) => r.include && !r.duplicateOf);
  const totals = selected.reduce(
    (acc, row) => {
      if (row.kind === "income") acc.income += row.amount;
      else acc.expense += row.amount;
      return acc;
    },
    { income: 0, expense: 0 },
  );
  const started = rows.length > 0 || batchesDone > 0;
  const canStart = !!file || text.trim().length >= 10;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-4xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4 text-primary" /> Importar fatura ou extrato com IA
          </DialogTitle>
        </DialogHeader>

        {config && !config.enabled && (
          <p className="rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
            A importação por IA não está configurada neste ambiente. Defina <code>PROVEDOR_IA</code>
            , <code>MODELO_IA</code> e <code>OPENAI_API_KEY</code> no serviço.
          </p>
        )}

        {!started ? (
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
                  <FileUp className="size-4" /> PDF, Word, Excel, CSV ou TXT
                </button>
              )}
              <p className="text-[11px] text-muted-foreground">
                O arquivo é convertido em texto na hora e mantido só em memória durante a
                importação. Nada é gravado em disco.
              </p>
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
              A IA usa as palavras-chave cadastradas em cada categoria para classificar as linhas.
              Documentos grandes são divididos em lotes e processados um por vez.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {summary && summary.totalBatches > 1 && (
              <p className="text-xs text-muted-foreground">
                {summary.source} · lote {batchesDone} de {summary.totalBatches} · {rows.length}{" "}
                lançamentos até agora
              </p>
            )}

            {/* Resumo somado pelo código a partir do que a IA devolveu. */}
            <div className="rounded-xl border border-border bg-surface p-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-xs font-semibold">Resumo da extração</p>
                <p className="text-[11px] text-muted-foreground">
                  {rows.length} linha{rows.length === 1 ? "" : "s"} lida
                  {rows.length === 1 ? "" : "s"} · {selected.length} selecionada
                  {selected.length === 1 ? "" : "s"} para lançar
                  {coverage.projectedRows > 0 &&
                    ` · ${coverage.projectedRows} parcela${coverage.projectedRows === 1 ? "" : "s"} futura${coverage.projectedRows === 1 ? "" : "s"}`}
                  {coverage.summaryRows > 0 && ` · ${coverage.summaryRows} fora (total/resumo)`}
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

            {lastDate && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card p-2.5 text-xs">
                <span>
                  {DATE_LABEL[lastDate.field].charAt(0).toUpperCase() +
                    DATE_LABEL[lastDate.field].slice(1)}{" "}
                  alterada para{" "}
                  <span className="font-semibold">{formatDateBR(lastDate.value)}</span>.
                </span>
                <span className="flex items-center gap-3">
                  <label className="flex cursor-pointer items-center gap-1.5">
                    <input
                      type="checkbox"
                      className="size-3.5 accent-[var(--color-primary)]"
                      checked={repeatDate[lastDate.field]}
                      onChange={(e) => {
                        setRepeatDate((prev) => ({
                          ...prev,
                          [lastDate.field]: e.target.checked,
                        }));
                        if (e.target.checked) applyDateToAll(lastDate.field, lastDate.value);
                      }}
                    />
                    Aplicar a todos os {rows.length} lançamentos
                  </label>
                  <button
                    onClick={() => setLastDate(null)}
                    className="text-muted-foreground transition-colors hover:text-foreground"
                    aria-label="Dispensar"
                  >
                    <X className="size-3.5" />
                  </button>
                </span>
              </div>
            )}

            {duplicates > 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <Ban className="size-4 shrink-0" />
                {duplicates === 1
                  ? "1 lançamento já existe no sistema e não será lançado de novo."
                  : `${duplicates} lançamentos já existem no sistema e não serão lançados de novo.`}
              </p>
            )}

            {coverage.summaryRows > 0 && (
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <span className="flex items-center gap-2">
                  <Ban className="size-4 shrink-0" />
                  {coverage.summaryRows === 1
                    ? "1 linha devolvida pela IA não corresponde a nenhum lançamento datado do documento (total, saldo ou resumo da fatura) e foi deixada de fora."
                    : `${coverage.summaryRows} linhas devolvidas pela IA não correspondem a lançamentos datados do documento (totais, saldos e resumo da fatura) e foram deixadas de fora.`}
                </span>
                <button
                  onClick={() => setShowSummaryRows((value) => !value)}
                  className="shrink-0 font-medium text-foreground underline underline-offset-2"
                >
                  {showSummaryRows ? "Ocultar" : "Mostrar mesmo assim"}
                </button>
              </div>
            )}

            {coverage.projectedRows > 0 && (
              <p className="flex items-center gap-2 rounded-xl border border-border bg-surface p-3 text-xs text-muted-foreground">
                <CalendarPlus className="size-4 shrink-0" />
                {coverage.projectedRows === 1
                  ? "1 parcela ainda não cobrada foi projetada a partir das compras parceladas da fatura, com vencimento no mês seguinte."
                  : `${coverage.projectedRows} parcelas ainda não cobradas foram projetadas a partir das compras parceladas da fatura, uma por mês.`}{" "}
                Elas entram como lançamento normal e não serão repetidas quando a próxima fatura for
                importada.
              </p>
            )}

            {coverage.recovered > 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <Sparkles className="size-4 shrink-0" />
                {coverage.recovered === 1
                  ? "1 lançamento tinha ficado de fora da resposta da IA e foi recuperado numa segunda passada."
                  : `${coverage.recovered} lançamentos tinham ficado de fora da resposta da IA e foram recuperados numa segunda passada.`}
              </p>
            )}

            {coverage.missing > 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs">
                <AlertTriangle className="size-4 shrink-0 text-negative" />
                {coverage.missing === 1
                  ? "1 linha do documento tem data e valor mas não virou lançamento. Confira a fatura antes de lançar."
                  : `${coverage.missing} linhas do documento têm data e valor mas não viraram lançamento. Confira a fatura antes de lançar.`}
              </p>
            )}

            {unverified > 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-negative/40 bg-negative/10 p-2.5 text-xs">
                <AlertTriangle className="size-4 shrink-0 text-negative" />
                {unverified === 1
                  ? "1 lançamento tem valor que não foi encontrado no documento. Confira antes de lançar."
                  : `${unverified} lançamentos têm valor que não foi encontrado no documento. Confira antes de lançar.`}
              </p>
            )}

            <div className="grid grid-cols-12 gap-2 px-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <span className="col-span-1" />
              <span className="col-span-3">Descrição</span>
              <span className="col-span-2">Lançamento</span>
              <span className="col-span-2">Vencimento</span>
              <span className="col-span-2">Categoria</span>
              <span className="col-span-2 text-right">Valor</span>
            </div>

            {visibleRows.map(({ row: r, index: i }) => {
              const blocked = !!r.duplicateOf;
              return (
                <div
                  key={i}
                  className={`grid grid-cols-12 items-center gap-2 rounded-xl border p-2 ${
                    blocked
                      ? "border-dashed border-border bg-muted/40 opacity-70"
                      : r.looksLikeSummary || !r.amountFound
                        ? "border-negative/50 bg-negative/5"
                        : r.projected
                          ? "border-dashed border-border bg-secondary/20"
                          : "border-border"
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={r.include}
                    disabled={blocked}
                    onChange={(e) => patch(i, { include: e.target.checked })}
                    className="col-span-1 size-4 accent-[var(--color-primary)] disabled:cursor-not-allowed"
                    aria-label={blocked ? "Lançamento já existente" : "Incluir lançamento"}
                  />
                  <div className="col-span-3 space-y-1">
                    <Input
                      className="h-8 text-xs"
                      value={r.description}
                      disabled={blocked}
                      onChange={(e) => patch(i, { description: e.target.value })}
                    />
                    {blocked && (
                      <span
                        className="flex items-center gap-1 text-[11px] text-muted-foreground"
                        title={`Já lançado em ${formatDateBR(r.duplicateOf!.date)} como "${r.duplicateOf!.description}"`}
                      >
                        <Ban className="size-3 shrink-0" /> Já lançado no sistema
                      </span>
                    )}
                    {r.installment_total ? (
                      <span className="flex flex-wrap items-center gap-1 text-[11px] text-muted-foreground">
                        <span className="rounded bg-secondary px-1.5 py-0.5 font-mono">
                          {r.installment_no}/{r.installment_total}
                        </span>
                        {r.projected && (
                          <span className="flex items-center gap-1">
                            <CalendarPlus className="size-3 shrink-0" /> parcela futura
                          </span>
                        )}
                      </span>
                    ) : null}
                    {!blocked && r.looksLikeSummary && (
                      <span
                        className="flex items-center gap-1 text-[11px] text-negative"
                        title="Nenhuma linha com data e este valor foi encontrada no documento. Costuma ser total, saldo ou resumo da fatura."
                      >
                        <AlertTriangle className="size-3 shrink-0" /> Parece total ou resumo
                      </span>
                    )}
                  </div>
                  <DateField
                    type="date"
                    className="col-span-2 h-8 text-xs"
                    value={r.date}
                    disabled={blocked}
                    onChange={(e) => patchDate(i, "date", e.target.value)}
                    aria-label="Data do lançamento"
                  />
                  <DateField
                    type="date"
                    className="col-span-2 h-8 text-xs"
                    value={r.due_date}
                    disabled={blocked}
                    onChange={(e) => patchDate(i, "due_date", e.target.value)}
                    aria-label="Data de vencimento"
                  />
                  <select
                    className="col-span-2 h-8 rounded-md border border-input bg-card px-2 text-xs disabled:opacity-60"
                    value={r.category_id}
                    disabled={blocked}
                    onChange={(e) => patch(i, { category_id: e.target.value })}
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
                    className={`col-span-2 flex items-center justify-end gap-1 text-right font-mono text-xs font-semibold ${
                      blocked
                        ? "text-muted-foreground line-through"
                        : r.kind === "income"
                          ? "text-positive"
                          : "text-negative"
                    }`}
                    title={r.amountFound ? undefined : "Valor não localizado no documento"}
                  >
                    {!blocked && !r.amountFound && (
                      <AlertTriangle className="size-3 text-negative" />
                    )}
                    {r.kind === "income" ? "+" : "−"}
                    {brl(r.amount)}
                  </span>
                </div>
              );
            })}

            <button
              onClick={() => {
                setRows([]);
                setSummary(null);
                setBatchesDone(0);
                setCoverage({ recovered: 0, missing: 0, summaryRows: 0, projectedRows: 0 });
              }}
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="size-3" /> Descartar análise
            </button>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          {!started ? (
            <Button onClick={start} disabled={loading || !canStart || config?.enabled === false}>
              {loading ? "Analisando…" : "Analisar com IA"}
            </Button>
          ) : (
            <>
              {pendingBatches > 0 && (
                <Button
                  variant="outline"
                  onClick={() => summary && runBatch(summary.importId)}
                  disabled={loading}
                >
                  {loading
                    ? "Processando…"
                    : `Processar mais (${pendingBatches} ${pendingBatches === 1 ? "lote" : "lotes"})`}
                </Button>
              )}
              <Button onClick={commit} disabled={upsert.isPending || loading}>
                Lançar selecionados
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

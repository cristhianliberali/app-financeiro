import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, Ban, FileUp, Sparkles, Trash2, X } from "lucide-react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { useCategories, useUpsert } from "@/lib/data";
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
  const { data: categories = [] } = useCategories(profileId);
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

  useEffect(() => {
    if (open) return;
    // Fechar o diálogo descarta o rascunho; o cache do servidor expira sozinho.
    setText("");
    setFile(null);
    setSummary(null);
    setBatchesDone(0);
    setRows([]);
  }, [open]);

  function toDraft(row: ParsedRow): Draft {
    return {
      ...row,
      // Duplicado nasce desmarcado: aparece na lista para o usuário ver que foi
      // reconhecido, mas não entra no lançamento em massa.
      include: !row.duplicateOf,
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
      })),
    );
    toast.success(`${selected.length} lançamentos importados`);
    onOpenChange(false);
  }

  const pendingBatches = summary && summary.importId ? summary.totalBatches - batchesDone : 0;
  const unverified = rows.filter((r) => !r.amountFound && !r.duplicateOf).length;
  const duplicates = rows.filter((r) => r.duplicateOf).length;
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
          <p className="rounded-lg border border-border bg-secondary/40 p-3 text-xs text-muted-foreground">
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

            {duplicates > 0 && (
              <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 p-2.5 text-xs text-muted-foreground">
                <Ban className="size-4 shrink-0" />
                {duplicates === 1
                  ? "1 lançamento já existe no sistema e não será lançado de novo."
                  : `${duplicates} lançamentos já existem no sistema e não serão lançados de novo.`}
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

            {rows.map((r, i) => {
              const blocked = !!r.duplicateOf;
              return (
                <div
                  key={i}
                  className={`grid grid-cols-12 items-center gap-2 rounded-xl border p-2 ${
                    blocked
                      ? "border-dashed border-border bg-muted/40 opacity-70"
                      : r.amountFound
                        ? "border-border"
                        : "border-negative/50 bg-negative/5"
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
                  </div>
                  <Input
                    type="date"
                    className="col-span-2 h-8 text-xs"
                    value={r.date}
                    disabled={blocked}
                    onChange={(e) => patch(i, { date: e.target.value })}
                    aria-label="Data do lançamento"
                  />
                  <Input
                    type="date"
                    className="col-span-2 h-8 text-xs"
                    value={r.due_date}
                    disabled={blocked}
                    onChange={(e) => patch(i, { due_date: e.target.value })}
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
                          {c.emoji} {c.name}
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

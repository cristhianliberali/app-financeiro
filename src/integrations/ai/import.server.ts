/**
 * Importação de faturas: prepara o documento, processa lote a lote e confere
 * o que a IA devolveu antes de mostrar ao usuário.
 */
import { query } from "../postgres/client.server";
import { getAiSettings } from "../postgres/config.server";
import { requireProfileAccess } from "../postgres/access.server";
import { createJob, dropJob, getJob, CACHE_TTL_MINUTES } from "./cache.server";
import { extractText, type UploadInput } from "./extract.server";
import { countTokens, splitIntoBatches } from "./tokens.server";
import { extractRows, type CategoryHint, type ExtractedRow } from "./openai.server";

export type ImportSummary = {
  importId: string;
  source: string;
  totalBatches: number;
  totalTokens: number;
  /** Minutos até a importação sair do cache do servidor. */
  expiresInMinutes: number;
};

export type ImportedRow = ExtractedRow & {
  /**
   * O valor foi encontrado literalmente no trecho enviado. Quando é falso, a
   * linha merece conferência — é o que impede um número inventado pela IA de
   * entrar despercebido.
   */
  amountFound: boolean;
};

export type BatchResult = {
  rows: ImportedRow[];
  batchNumber: number;
  totalBatches: number;
  done: boolean;
};

async function categoryHints(profileId: string): Promise<CategoryHint[]> {
  return query<CategoryHint>(
    `SELECT name, description FROM categories WHERE profile_id = $1 ORDER BY name`,
    [profileId],
  );
}

/**
 * Formas em que um mesmo valor pode aparecer na fatura: 1234.56 pode estar
 * escrito como "1.234,56", "1234,56", "1,234.56" ou "1234.56".
 */
function amountVariants(amount: number): string[] {
  const fixed = Math.abs(amount).toFixed(2);
  const [whole, cents] = fixed.split(".") as [string, string];
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  return [
    `${whole},${cents}`,
    `${whole}.${cents}`,
    `${grouped.replace(/ /g, ".")},${cents}`,
    `${grouped.replace(/ /g, ",")}.${cents}`,
  ];
}

/** O valor extraído aparece mesmo no documento? */
function amountAppearsIn(text: string, amount: number): boolean {
  return amountVariants(amount).some((variant) => text.includes(variant));
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sanitize(row: ExtractedRow, text: string, today: string): ImportedRow {
  const amount = Math.abs(Number(row.amount)) || 0;
  const date = ISO_DATE.test(row.date) ? row.date : today;
  return {
    description:
      String(row.description ?? "")
        .trim()
        .slice(0, 300) || "Lançamento",
    amount,
    kind: row.kind === "income" ? "income" : "expense",
    date,
    due_date: ISO_DATE.test(row.due_date) ? row.due_date : date,
    category: String(row.category ?? "").trim(),
    installment_no: Number.isInteger(row.installment_no) ? row.installment_no : null,
    installment_total: Number.isInteger(row.installment_total) ? row.installment_total : null,
    amountFound: amount > 0 && amountAppearsIn(text, amount),
  };
}

/**
 * Lê o documento (ou o texto colado), divide em lotes pelo `LIMITE_TOKENS` e
 * guarda em cache. Nenhuma requisição de IA acontece aqui — só preparação.
 */
export async function prepareImport(
  userId: string,
  input: { profileId: string; text?: string; file?: UploadInput },
): Promise<ImportSummary> {
  await requireProfileAccess(userId, input.profileId, "editor");
  const settings = getAiSettings();

  let text: string;
  let source: string;
  if (input.file) {
    const extracted = await extractText(input.file);
    text = extracted.text;
    source = input.file.name;
  } else {
    text = (input.text ?? "").trim();
    source = "texto colado";
  }
  if (text.length < 10) throw new Error("Não há texto suficiente para analisar.");

  const totalTokens = await countTokens(text);
  const batches = await splitIntoBatches(text, settings.tokenLimit);
  const job = createJob({ userId, source, batches, totalTokens });

  return {
    importId: job.id,
    source,
    totalBatches: batches.length,
    totalTokens,
    expiresInMinutes: CACHE_TTL_MINUTES,
  };
}

/** Processa o próximo lote pendente da importação. Uma requisição por chamada. */
export async function processNextBatch(
  userId: string,
  input: { importId: string; profileId: string },
): Promise<BatchResult> {
  await requireProfileAccess(userId, input.profileId, "editor");
  const job = getJob(userId, input.importId);

  const batch = job.batches[job.nextIndex];
  if (!batch) throw new Error("Todos os lotes desta importação já foram processados.");

  const rows = await extractRows({
    text: batch.text,
    categories: await categoryHints(input.profileId),
  });

  // Só avança depois do sucesso: se a requisição falhar, o mesmo lote é
  // reprocessado no próximo clique em vez de ser pulado.
  job.nextIndex += 1;
  const done = job.nextIndex >= job.batches.length;
  if (done) dropJob(userId, job.id);

  const today = new Date().toISOString().slice(0, 10);
  return {
    rows: rows.map((row) => sanitize(row, batch.text, today)),
    batchNumber: job.nextIndex,
    totalBatches: job.batches.length,
    done,
  };
}

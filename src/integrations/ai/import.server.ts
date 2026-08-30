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
import { newRequestId, type AiLogContext } from "./logs.server";
import { amountAppearsIn } from "./amounts.server";
import {
  capacityByAmount,
  documentHeader,
  entryLines,
  matchRowsToEntries,
  uncoveredEntries,
} from "./coverage.server";

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
  /**
   * Lançamento já existente no perfil com a mesma descrição, valor e data.
   * A tela mostra a linha, mas não deixa lançar de novo.
   */
  duplicateOf: { id: string; description: string; date: string } | null;
  /**
   * O valor casa com alguma linha datada do documento. Quando é falso, a linha
   * quase sempre saiu de um total ou resumo — "FATURA ANTERIOR", "DESPESAS/
   * DÉBITOS", resumo por categoria —, e lançar isso somaria de novo o que já
   * está lançado. Chega desmarcada na tela, para conferência.
   */
  looksLikeSummary: boolean;
};

export type BatchResult = {
  rows: ImportedRow[];
  batchNumber: number;
  totalBatches: number;
  done: boolean;
  /** Lançamentos que só apareceram na segunda passada sobre as linhas faltantes. */
  recovered: number;
  /** Linhas com data e valor que continuaram sem lançamento depois das passadas. */
  missing: number;
  /** Lançamentos devolvidos que não casam com nenhuma linha datada do documento. */
  summaryRows: number;
  /** Lotes pulados por não terem lançamento nenhum — cabeçalho, resumo, totais. */
  skippedBatches: number;
};

/**
 * Categorias oferecidas ao modelo. As arquivadas ficam de fora: elas continuam
 * nos relatórios do que já foi lançado, mas não recebem lançamento novo.
 */
async function categoryHints(profileId: string): Promise<CategoryHint[]> {
  return query<CategoryHint>(
    `SELECT name, description FROM categories
      WHERE profile_id = $1 AND archived_at IS NULL
      ORDER BY name`,
    [profileId],
  );
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Chave de comparação de um lançamento: data, valor e descrição.
 *
 * A descrição é normalizada só no que não muda o significado — espaços
 * repetidos e maiúsculas —, para "MERCADOLIVRE*4PRODUT" e
 * "Mercadolivre*4produt" contarem como o mesmo lançamento.
 */
function duplicateKey(date: string, amount: number, description: string): string {
  const normalized = description.trim().replace(/\s+/g, " ").toLowerCase();
  return `${date}|${amount.toFixed(2)}|${normalized}`;
}

type ExistingRow = { id: string; description: string; amount: number; transaction_date: string };

/**
 * Indexa os lançamentos que o perfil já tem nas datas em questão. A janela é
 * limitada às datas que a IA devolveu, então não varre o histórico inteiro.
 */
async function existingByKey(
  profileId: string,
  dates: string[],
): Promise<Map<string, ExistingRow>> {
  const index = new Map<string, ExistingRow>();
  if (dates.length === 0) return index;

  const rows = await query<ExistingRow>(
    `SELECT id, description, amount, transaction_date::text AS transaction_date
       FROM transactions
      WHERE profile_id = $1 AND transaction_date = ANY($2::date[])`,
    [profileId, dates],
  );
  for (const row of rows) {
    index.set(duplicateKey(row.transaction_date, Number(row.amount), row.description), row);
  }
  return index;
}

function sanitize(
  row: ExtractedRow,
  text: string,
  today: string,
): Omit<ImportedRow, "duplicateOf" | "looksLikeSummary"> {
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
  const batches = await splitIntoBatches(text, settings.tokenLimit, settings.entryLimit);
  const job = createJob({ userId, source, batches, totalTokens, header: documentHeader(text) });

  console.info(
    `[ia] importação ${job.id} preparada: usuário=${userId} perfil=${input.profileId} ` +
      `origem="${source}" caracteres=${text.length} tokens=${totalTokens} ` +
      `lotes=${batches.length} (limite ${settings.tokenLimit} tokens / ` +
      `${settings.entryLimit} lançamentos por lote)`,
  );

  return {
    importId: job.id,
    source,
    totalBatches: batches.length,
    totalTokens,
    expiresInMinutes: CACHE_TTL_MINUTES,
  };
}

/** Quantas vezes o servidor insiste nas linhas que ficaram sem lançamento. */
const MAX_RECOVERY_PASSES = 2;

/**
 * Segunda (e terceira) passada sobre o que o modelo deixou passar.
 *
 * A conferência é por valor: toda linha com data e valor precisa ter um
 * lançamento correspondente. As que não têm voltam para o modelo sozinhas — um
 * punhado de linhas em vez da fatura inteira, que é justamente a situação em
 * que ele acerta. O teto por valor impede que a repescagem devolva de novo o
 * que já veio: só entram tantos lançamentos de um valor quantas linhas do
 * documento têm aquele valor.
 */
async function recoverMissingRows(input: {
  text: string;
  rows: ExtractedRow[];
  categories: CategoryHint[];
  log: AiLogContext;
}): Promise<{ extra: ExtractedRow[]; missing: string[] }> {
  const entries = entryLines(input.text);
  if (entries.length === 0) return { extra: [], missing: [] };

  const capacity = capacityByAmount(entries);
  const extra: ExtractedRow[] = [];
  let pending = uncoveredEntries(entries, input.rows);

  for (let pass = 1; pass <= MAX_RECOVERY_PASSES && pending.length > 0; pass += 1) {
    console.info(
      `[ia ${input.log.requestId}] ${pending.length} linha(s) sem lançamento; ` +
        `passada de recuperação ${pass}/${MAX_RECOVERY_PASSES}`,
    );

    const recovered = await extractRows({
      text: pending.map((entry) => entry.text).join("\n"),
      categories: input.categories,
      log: { ...input.log, attempt: pass },
      recovery: true,
    });
    if (recovered.length === 0) break;

    // Aceita só até o que o documento comporta daquele valor.
    const used = new Map<string, number>();
    for (const row of [...input.rows, ...extra]) {
      const key = Math.abs(Number(row.amount) || 0).toFixed(2);
      used.set(key, (used.get(key) ?? 0) + 1);
    }

    const accepted = recovered.filter((row) => {
      const key = Math.abs(Number(row.amount) || 0).toFixed(2);
      const room = (capacity.get(key) ?? 0) - (used.get(key) ?? 0);
      if (room <= 0) return false;
      used.set(key, (used.get(key) ?? 0) + 1);
      return true;
    });
    if (accepted.length === 0) break;

    extra.push(...accepted);
    pending = uncoveredEntries(entries, [...input.rows, ...extra]);
  }

  if (pending.length > 0) {
    console.warn(
      `[ia ${input.log.requestId}] ${pending.length} linha(s) seguiram sem lançamento ` +
        `depois das passadas de recuperação:\n` +
        pending.map((entry) => `  · ${entry.text}`).join("\n"),
    );
  }

  return { extra, missing: pending.map((entry) => entry.text) };
}

/** Processa o próximo lote pendente da importação. Uma requisição por chamada. */
export async function processNextBatch(
  userId: string,
  input: { importId: string; profileId: string },
): Promise<BatchResult> {
  await requireProfileAccess(userId, input.profileId, "editor");
  const job = getJob(userId, input.importId);

  if (job.nextIndex >= job.batches.length) {
    throw new Error("Todos os lotes desta importação já foram processados.");
  }

  /**
   * Lote sem nenhuma linha datada é só cabeçalho, encargos e resumo da fatura —
   * e é onde o modelo mais erra: mandado a extrair "um lançamento por linha" num
   * trecho que só tem totais, ele devolve os totais. Esses lotes não vão para a
   * IA; a fatura que motivou isto tinha 129 linhas assim, com um lançamento.
   */
  let skipped = 0;
  while (job.nextIndex < job.batches.length) {
    const candidate = job.batches[job.nextIndex]!;
    if (entryLines(candidate.text).length > 0) break;
    console.info(
      `[ia] importação ${job.id}: lote ${job.nextIndex + 1}/${job.batches.length} ` +
        `sem linha de lançamento (${candidate.text.split("\n").length} linhas de ` +
        `cabeçalho/resumo) — não vai para a IA`,
    );
    job.nextIndex += 1;
    skipped += 1;
  }

  const batch = job.batches[job.nextIndex];
  if (!batch) {
    // Só restavam lotes de cabeçalho: a importação acaba aqui, sem requisição.
    dropJob(userId, job.id);
    return {
      rows: [],
      batchNumber: job.nextIndex,
      totalBatches: job.batches.length,
      done: true,
      recovered: 0,
      missing: 0,
      summaryRows: 0,
      skippedBatches: skipped,
    };
  }

  const log: AiLogContext = {
    requestId: newRequestId(),
    userId,
    profileId: input.profileId,
    importId: job.id,
    batch: job.nextIndex + 1,
    totalBatches: job.batches.length,
  };

  const categories = await categoryHints(input.profileId);
  // O cabeçalho vai junto só quando não é o próprio começo do documento, para
  // não repetir o trecho dentro do lote que já o contém.
  const header = job.nextIndex === 0 ? "" : job.header;
  const rows = await extractRows({ text: batch.text, categories, log, header });

  // Confere o que ficou de fora e pede de novo, só as linhas faltantes.
  const { extra, missing } = await recoverMissingRows({
    text: batch.text,
    rows,
    categories,
    log,
  });
  rows.push(...extra);

  // Só avança depois do sucesso: se a requisição falhar, o mesmo lote é
  // reprocessado no próximo clique em vez de ser pulado.
  job.nextIndex += 1;
  const done = job.nextIndex >= job.batches.length;
  if (done) dropJob(userId, job.id);

  const today = new Date().toISOString().slice(0, 10);
  // Conferência inversa: o que voltou existe mesmo como lançamento no documento?
  const matched = matchRowsToEntries(entryLines(batch.text), rows);
  const clean = matched.map((row) => ({
    ...sanitize(row, batch.text, today),
    looksLikeSummary: !row.matchesEntry,
  }));

  // Marca o que o perfil já tem lançado, para a tela mostrar sem deixar repetir.
  const existing = await existingByKey(input.profileId, [...new Set(clean.map((r) => r.date))]);

  const checked: ImportedRow[] = clean.map((row) => {
    const found = existing.get(duplicateKey(row.date, row.amount, row.description));
    return {
      ...row,
      duplicateOf: found
        ? { id: found.id, description: found.description, date: found.transaction_date }
        : null,
    };
  });

  // O que a conferência do servidor fez com a resposta do modelo — é o que
  // explica, no log, por que uma linha chegou marcada na tela.
  console.info(
    `[ia ${log.requestId}] conferência: lançamentos=${checked.length} ` +
      `recuperados=${extra.length} linhas_sem_lançamento=${missing.length} ` +
      `valor_não_encontrado=${checked.filter((row) => !row.amountFound).length} ` +
      `parecem_resumo=${checked.filter((row) => row.looksLikeSummary).length} ` +
      `duplicados=${checked.filter((row) => row.duplicateOf).length}`,
  );

  const summaryRows = checked.filter((row) => row.looksLikeSummary);
  if (summaryRows.length > 0) {
    console.warn(
      `[ia ${log.requestId}] ${summaryRows.length} linha(s) devolvidas não casam com ` +
        `nenhum lançamento do documento (provável total ou resumo):\n` +
        summaryRows.map((row) => `  · ${row.description} — ${row.amount}`).join("\n"),
    );
  }

  return {
    rows: checked,
    batchNumber: job.nextIndex,
    totalBatches: job.batches.length,
    done,
    recovered: extra.length,
    missing: missing.length,
    summaryRows: summaryRows.length,
    skippedBatches: skipped,
  };
}

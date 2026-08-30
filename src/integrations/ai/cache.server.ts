/**
 * Cache em memória das importações em andamento.
 *
 * O documento é lido uma vez, dividido em lotes e fica aqui enquanto o usuário
 * processa lote a lote. Nada é gravado em disco nem em storage externo, e cada
 * importação expira sozinha — arquivo de fatura não fica guardado no servidor.
 *
 * Por ser memória do processo, o estado não sobrevive a um restart do container
 * nem é compartilhado entre réplicas: nesse caso o usuário recomeça a
 * importação, que é barato. Se um dia o app rodar com mais de uma réplica, isto
 * aqui vira uma tabela.
 */
import { randomUUID } from "node:crypto";

import type { Batch } from "./tokens.server";

/** Tempo que uma importação inacabada continua disponível. */
const TTL_MS = 30 * 60 * 1000;
/** Teto de importações simultâneas por usuário, para não segurar memória à toa. */
const MAX_JOBS_PER_USER = 3;

export type ImportJob = {
  id: string;
  userId: string;
  /** Nome do arquivo, ou "texto colado". */
  source: string;
  batches: Batch[];
  /** Índice do próximo lote a processar. */
  nextIndex: number;
  /**
   * Começo do documento (vencimento, período, titular). Vai junto em cada lote
   * como referência: sem isso, só o primeiro lote enxerga essas datas.
   */
  header: string;
  totalTokens: number;
  expiresAt: number;
};

const jobs = new Map<string, ImportJob>();

function purgeExpired(): void {
  const now = Date.now();
  for (const [id, job] of jobs) if (job.expiresAt <= now) jobs.delete(id);
}

export function createJob(input: {
  userId: string;
  source: string;
  batches: Batch[];
  totalTokens: number;
  header: string;
}): ImportJob {
  purgeExpired();

  // Mantém apenas as importações mais recentes do usuário.
  const mine = [...jobs.values()]
    .filter((job) => job.userId === input.userId)
    .sort((a, b) => b.expiresAt - a.expiresAt);
  for (const old of mine.slice(MAX_JOBS_PER_USER - 1)) jobs.delete(old.id);

  const job: ImportJob = {
    id: randomUUID(),
    userId: input.userId,
    source: input.source,
    batches: input.batches,
    nextIndex: 0,
    header: input.header,
    totalTokens: input.totalTokens,
    expiresAt: Date.now() + TTL_MS,
  };
  jobs.set(job.id, job);
  return job;
}

/** Devolve a importação do próprio usuário, renovando o prazo de expiração. */
export function getJob(userId: string, id: string): ImportJob {
  purgeExpired();
  const job = jobs.get(id);
  if (!job || job.userId !== userId) {
    throw new Error("Importação expirada ou não encontrada. Envie o documento novamente.");
  }
  job.expiresAt = Date.now() + TTL_MS;
  return job;
}

export function dropJob(userId: string, id: string): void {
  const job = jobs.get(id);
  if (job && job.userId === userId) jobs.delete(id);
}

export const CACHE_TTL_MINUTES = TTL_MS / 60_000;

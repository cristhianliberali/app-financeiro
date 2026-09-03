/**
 * Agendador da sincronização com o Google Agenda.
 *
 * Um laço só no processo, que a cada rodada pega quem já passou do intervalo e
 * puxa as mudanças da agenda daquela pessoa. É polling e não webhook de
 * propósito: o webhook do Google (`watch`) exige um endereço público que ele
 * consiga alcançar e renovação de canal a cada semana — o polling incremental,
 * com `syncToken`, custa uma chamada por usuário a cada dez minutos e sobrevive
 * a qualquer topologia de rede.
 *
 * Começa sozinho na primeira requisição autenticada e não é reiniciado depois
 * (`ensureCalendarScheduler` é idempotente). Se o processo cair, o próximo
 * acesso o levanta de novo — e nada se perde, porque o marcador de
 * sincronização fica no banco.
 *
 * Um laço preso ao processo web, porém, é mudo: de fora não há como saber se
 * ele está vivo, e sem tráfego autenticado ele nem chega a subir. Por isso a
 * rodada é uma função exportada (`runSyncRound`), que devolve o que fez — a
 * rota `POST /api/google/sync` a chama com um segredo, e aí um cron externo
 * garante a execução e responde, com números, se a rodada roda ou não.
 */
import { getGoogleSettings, getGoogleSyncToken, isGoogleConfigured } from "./config.server";

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

/** O que uma rodada fez, somado entre todos os usuários que ela varreu. */
export type SyncRoundSummary = {
  usuarios: number;
  lidos: number;
  atualizados: number;
  limpos: number;
  enviados: number;
  recusados: number;
  falhas: Array<{ userId: string; erro: string }>;
  /** Outra rodada já estava em andamento: esta não fez nada, de propósito. */
  emAndamento: boolean;
};

const RODADA_VAZIA: SyncRoundSummary = {
  usuarios: 0,
  lidos: 0,
  atualizados: 0,
  limpos: 0,
  enviados: 0,
  recusados: 0,
  falhas: [],
  emAndamento: false,
};

/**
 * Uma rodada completa: todo mundo que já passou do intervalo.
 *
 * A falha de um usuário não interrompe os outros — uma conta com o acesso
 * revogado deixaria a agenda de todos os demais parada.
 */
export async function runSyncRound(): Promise<SyncRoundSummary> {
  if (running) return { ...RODADA_VAZIA, emAndamento: true };
  running = true;

  const resumo: SyncRoundSummary = { ...RODADA_VAZIA, falhas: [] };
  try {
    const { syncIntervalMinutes } = getGoogleSettings();
    const { usersDueForSync, syncUser } = await import("./google.server");

    const users = await usersDueForSync(syncIntervalMinutes);
    resumo.usuarios = users.length;

    for (const userId of users) {
      try {
        const result = await syncUser(userId);
        resumo.lidos += result.read;
        resumo.atualizados += result.updated;
        resumo.limpos += result.cleared;
        resumo.enviados += result.pushed;
        resumo.recusados += result.refused;
        if (result.error) resumo.falhas.push({ userId, erro: result.error });

        if (result.cleared > 0 || result.updated > 0) {
          console.info(
            `[agenda] usuário ${userId}: ${result.updated} compromisso(s) movido(s) na agenda ` +
              `atualizaram as datas da tarefa, ${result.cleared} apagado(s) as limparam`,
          );
        }
      } catch (error) {
        const erro = error instanceof Error ? error.message : String(error);
        resumo.falhas.push({ userId, erro });
        console.error(`[agenda] sincronização do usuário ${userId} falhou:`, error);
      }
    }
  } catch (error) {
    const erro = error instanceof Error ? error.message : String(error);
    resumo.falhas.push({ userId: "(rodada)", erro });
    console.error("[agenda] rodada de sincronização falhou:", error);
  } finally {
    running = false;
  }

  return resumo;
}

/**
 * A rodada pedida por HTTP, com a conferência do segredo.
 *
 * Mora aqui, e não na rota, pelo mesmo motivo que `finishGoogleConnection`
 * mora em `google-oauth.server`: a rota fica com o roteamento e a regra fica
 * onde o teste alcança sem subir o router.
 */
export async function handleSyncRequest(request: Request): Promise<Response> {
  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });

  if (!isGoogleConfigured()) {
    return json(503, { erro: "Integração com o Google Agenda não configurada." });
  }

  const esperado = getGoogleSyncToken();
  if (!esperado) {
    return json(503, { erro: "Defina GOOGLE_SYNC_TOKEN para habilitar esta rota." });
  }

  // As duas formas que um cron costuma ter à mão, e nenhuma delas pela URL:
  // segredo em query string acaba no log de acesso do proxy.
  const header = request.headers.get("authorization");
  const recebido = header?.startsWith("Bearer ")
    ? header.slice("Bearer ".length)
    : (request.headers.get("x-sync-token") ?? "");

  const { timingSafeEqual } = await import("node:crypto");
  const a = Buffer.from(recebido);
  const b = Buffer.from(esperado);
  // `timingSafeEqual` exige tamanhos iguais; conferir o tamanho antes não conta
  // nada que a própria recusa já não conte.
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json(401, { erro: "Segredo inválido." });
  }

  const resumo = await runSyncRound();
  // Falha de um usuário não invalida a rodada: 207 diz que ela aconteceu e que
  // parte dela não deu certo, com a lista de quem falhou no corpo.
  return json(resumo.falhas.length > 0 ? 207 : 200, resumo);
}

/** Liga o agendador uma vez por processo. Sem Google configurado, é no-op. */
export function ensureCalendarScheduler(): void {
  if (timer || !isGoogleConfigured()) return;

  const { syncIntervalMinutes } = getGoogleSettings();
  const everyMs = Math.max(1, syncIntervalMinutes) * 60_000;

  timer = setInterval(() => void runSyncRound(), everyMs);
  // Um processo que só sincroniza não precisa ficar vivo por causa disto.
  timer.unref?.();

  console.info(`[agenda] sincronização automática a cada ${syncIntervalMinutes} minuto(s)`);
  void runSyncRound();
}

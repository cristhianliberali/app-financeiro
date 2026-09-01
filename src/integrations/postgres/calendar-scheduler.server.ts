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
 */
import { getGoogleSettings, isGoogleConfigured } from "./config.server";

let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

async function runRound(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const { syncIntervalMinutes } = getGoogleSettings();
    const { usersDueForSync, syncUser } = await import("./google.server");

    const users = await usersDueForSync(syncIntervalMinutes);
    for (const userId of users) {
      try {
        const result = await syncUser(userId);
        if (result.cleared > 0 || result.updated > 0) {
          console.info(
            `[agenda] usuário ${userId}: ${result.updated} compromisso(s) movido(s) na agenda ` +
              `atualizaram as datas da tarefa, ${result.cleared} apagado(s) as limparam`,
          );
        }
      } catch (error) {
        console.error(`[agenda] sincronização do usuário ${userId} falhou:`, error);
      }
    }
  } catch (error) {
    console.error("[agenda] rodada de sincronização falhou:", error);
  } finally {
    running = false;
  }
}

/** Liga o agendador uma vez por processo. Sem Google configurado, é no-op. */
export function ensureCalendarScheduler(): void {
  if (timer || !isGoogleConfigured()) return;

  const { syncIntervalMinutes } = getGoogleSettings();
  const everyMs = Math.max(1, syncIntervalMinutes) * 60_000;

  timer = setInterval(() => void runRound(), everyMs);
  // Um processo que só sincroniza não precisa ficar vivo por causa disto.
  timer.unref?.();

  console.info(`[agenda] sincronização automática a cada ${syncIntervalMinutes} minuto(s)`);
  void runRound();
}

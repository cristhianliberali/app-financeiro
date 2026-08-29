import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useAckReminders, useDueReminders, type ReminderFeedItem } from "@/lib/tasks";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

function currentPermission(): NotificationPermissionState {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

/**
 * Lembretes de tarefa entregues como notificação no app.
 *
 * O servidor mantém a fila (`task_reminders`): aqui só perguntamos de tempos em
 * tempos o que já venceu, mostramos, e confirmamos a entrega — é a confirmação
 * que impede o mesmo lembrete de aparecer de novo a cada recarga.
 *
 * A notificação é a nativa do sistema operacional (Notification API), então ela
 * aparece fora da aba enquanto o app estiver aberto. Quando a permissão não foi
 * concedida, o aviso ainda chega como um toast dentro da tela.
 */
export function useTaskNotifications(enabled: boolean) {
  const [permission, setPermission] = useState<NotificationPermissionState>("unsupported");
  const { data: due = [] } = useDueReminders(enabled);
  const ack = useAckReminders();
  // Ids já exibidos nesta aba: a confirmação é assíncrona e o refetch pode
  // acontecer antes dela terminar.
  const shown = useRef<Set<string>>(new Set());

  useEffect(() => setPermission(currentPermission()), []);

  const requestPermission = useCallback(async () => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      toast.error("Este navegador não suporta notificações");
      return;
    }
    const result = await Notification.requestPermission();
    setPermission(result as NotificationPermissionState);
    if (result === "granted") toast.success("Notificações ativadas");
    else if (result === "denied") {
      toast.error("Notificações bloqueadas — libere nas configurações do navegador");
    }
  }, []);

  useEffect(() => {
    if (!enabled || due.length === 0) return;

    const fresh = due.filter((reminder) => !shown.current.has(reminder.id));
    if (fresh.length === 0) return;
    for (const reminder of fresh) shown.current.add(reminder.id);

    for (const reminder of fresh) {
      const body = reminder.note?.trim()
        ? reminder.note
        : `${reminder.space_name} › ${reminder.board_name}`;

      if (permission === "granted") {
        try {
          // `tag` faz o SO substituir a notificação anterior do mesmo lembrete
          // em vez de empilhar duplicatas.
          new Notification(`Lembrete: ${reminder.task_title}`, {
            body,
            tag: `task-reminder-${reminder.id}`,
          });
        } catch (error) {
          console.error("[lembretes] não foi possível notificar:", error);
        }
      }

      toast(`Lembrete: ${reminder.task_title}`, { description: body, duration: 10_000 });
    }

    ack.mutate(fresh.map((reminder) => reminder.id));
    // `ack` muda de identidade a cada render do react-query; incluí-lo aqui
    // reenviaria a confirmação em loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [due, enabled, permission]);

  return { permission, requestPermission, due: due as ReminderFeedItem[] };
}

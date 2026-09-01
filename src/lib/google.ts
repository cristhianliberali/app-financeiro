import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { TASKS_QUERY_KEY } from "./tasks";
import {
  diagnoseCalendarSync,
  disconnectGoogle,
  fetchAgendaEvents,
  getGoogleStatus,
  startGoogleConnection,
  syncGoogleNow,
  type AgendaEvent,
  type GoogleStatus,
} from "./google.functions";

export type { AgendaEvent, GoogleStatus };

export function useGoogleStatus() {
  return useQuery({
    queryKey: ["google-status"],
    queryFn: () => getGoogleStatus(),
    staleTime: 60 * 1000,
  });
}

/** Compromissos da agenda na janela mostrada pelo calendário. */
export function useAgendaEvents(range: { from: string; to: string } | null) {
  return useQuery({
    queryKey: ["agenda-events", range?.from, range?.to],
    enabled: !!range,
    queryFn: () => fetchAgendaEvents({ data: range! }),
    // A sincronização automática é de dez em dez minutos; buscar mais que isso
    // só gastaria cota do Google sem trazer novidade.
    staleTime: 5 * 60 * 1000,
  });
}

export function useConnectGoogle() {
  return useMutation({
    mutationFn: async () => {
      const { url } = await startGoogleConnection();
      window.location.href = url;
    },
  });
}

export function useDisconnectGoogle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      await disconnectGoogle();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["google-status"] });
      qc.invalidateQueries({ queryKey: ["agenda-events"] });
    },
  });
}

/** Retrato do que o Google devolve agora — o botão de diagnóstico do perfil. */
export function useDiagnoseCalendar() {
  return useMutation({ mutationFn: () => diagnoseCalendarSync() });
}

/** Botão de sincronizar na hora, sem esperar a rodada automática. */
export function useSyncGoogleNow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => syncGoogleNow(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["agenda-events"] });
      qc.invalidateQueries({ queryKey: ["google-status"] });
      qc.invalidateQueries({ queryKey: [TASKS_QUERY_KEY] });
    },
  });
}

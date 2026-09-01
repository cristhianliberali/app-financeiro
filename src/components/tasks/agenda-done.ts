import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "aura.meuDia.agendaConcluida";
/** Depois disso a marca é lixo: o compromisso já saiu de qualquer "hoje". */
const KEEP_DAYS = 45;

/**
 * Compromissos da agenda marcados como cumpridos em "Meu dia".
 *
 * Marcar aqui não escreve nada no Google. O compromisso sincronizado é espelho
 * de outro sistema — não há status para atualizar lá, e inventar um seria
 * mentir sobre o que o app faz. O que a marca entrega é o que a tarefa entrega:
 * o dia fechado por inteiro, sem um item aceso que já aconteceu.
 *
 * Por ser sinal só de leitura, ele vive no navegador de quem marcou, não no
 * banco: nada aqui muda o que a equipe vê.
 */
type DoneMap = Record<string, string>;

function read(): DoneMap {
  if (typeof localStorage === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const map: DoneMap = {};
    for (const [id, day] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof day === "string") map[id] = day;
    }
    return map;
  } catch {
    // Preferência corrompida não pode impedir o painel de abrir.
    return {};
  }
}

/** Some com o que já passou da janela — a marca não precisa durar mais que o dia. */
function prune(map: DoneMap, today: string): DoneMap {
  const limit = new Date(today);
  limit.setDate(limit.getDate() - KEEP_DAYS);
  const cutoff = limit.toISOString().slice(0, 10);
  return Object.fromEntries(Object.entries(map).filter(([, day]) => day >= cutoff));
}

/**
 * Estado das marcas, já podado. O primeiro render vem vazio de propósito: ler
 * `localStorage` na renderização quebraria a hidratação do servidor.
 */
export function useAgendaDone(today: string) {
  const [done, setDone] = useState<DoneMap>({});

  useEffect(() => {
    const pruned = prune(read(), today);
    setDone(pruned);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
    } catch {
      // Sem espaço ou em aba privada: a marca vale só para esta sessão.
    }
  }, [today]);

  const toggle = useCallback(
    (eventId: string, day: string) => {
      setDone((current) => {
        const next = { ...current };
        if (next[eventId]) delete next[eventId];
        else next[eventId] = day;
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          // Idem: a marca segue valendo em memória.
        }
        return next;
      });
    },
    [setDone],
  );

  const isDone = useCallback((eventId: string) => !!done[eventId], [done]);

  return { isDone, toggle };
}

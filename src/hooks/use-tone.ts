import { useCallback } from "react";

import { useTheme } from "@/lib/theme";
import { invertTone } from "@/lib/tasks-analytics";

/**
 * Adapta um tom da paleta ao tema atual.
 *
 * Devolve a cor como está no claro e o tom espelhado no escuro — é o que
 * mantém legíveis os pontinhos de status, quadro e etiqueta, cujas cores ficam
 * gravadas no banco e não conhecem o tema.
 */
export function useTone() {
  const { resolved } = useTheme();
  return useCallback((hex: string) => (resolved === "dark" ? invertTone(hex) : hex), [resolved]);
}

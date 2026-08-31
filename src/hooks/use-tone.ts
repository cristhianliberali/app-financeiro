import { useCallback } from "react";

import { useTheme } from "@/lib/theme";
import { toneForDark } from "@/lib/tasks-analytics";

/**
 * Adapta um tom da paleta ao tema atual.
 *
 * Devolve a cor como está no claro e a versão clareada no escuro — é o que
 * mantém legíveis os pontinhos de status, quadro e etiqueta, cujas cores ficam
 * gravadas no banco e não conhecem o tema.
 */
export function useTone() {
  const { resolved } = useTheme();
  return useCallback((hex: string) => (resolved === "dark" ? toneForDark(hex) : hex), [resolved]);
}

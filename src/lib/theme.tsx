import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * Tema preto e branco do app.
 *
 * `system` acompanha a preferência do sistema operacional; `light` e `dark`
 * fixam a escolha. O valor fica no localStorage e é aplicado como a classe
 * `dark` no <html>, que é o gancho que o Tailwind usa.
 */
export type ThemePreference = "light" | "dark" | "system";

export const THEME_STORAGE_KEY = "aura.theme";

/**
 * Roda antes da primeira pintura, ainda no <head>, para o tema já entrar
 * aplicado. Sem isso a página nasce clara e pisca ao trocar para o escuro.
 */
export const THEME_INIT_SCRIPT = `(function(){try{
var p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||'system';
var d=p==='dark'||(p==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);
document.documentElement.classList.toggle('dark',d);
}catch(e){}})();`;

type Ctx = {
  /** O que o usuário escolheu. */
  preference: ThemePreference;
  /** O que está de fato na tela depois de resolver `system`. */
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
  /** Alterna direto entre claro e escuro, ignorando `system`. */
  toggle: () => void;
};

const ThemeContext = createContext<Ctx | null>(null);

const prefersDark = () =>
  typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;

const resolve = (preference: ThemePreference): "light" | "dark" =>
  preference === "system" ? (prefersDark() ? "dark" : "light") : preference;

export function ThemeProvider({ children }: { children: ReactNode }) {
  // O servidor não conhece a preferência; começamos em "system" e o efeito
  // abaixo corrige assim que o componente monta no navegador.
  const [preference, setPreferenceState] = useState<ThemePreference>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("light");

  useEffect(() => {
    const saved = localStorage.getItem(THEME_STORAGE_KEY) as ThemePreference | null;
    const next = saved === "light" || saved === "dark" || saved === "system" ? saved : "system";
    setPreferenceState(next);
    setResolved(resolve(next));
  }, []);

  // Em "system", seguir a troca de tema do SO enquanto a aba está aberta.
  useEffect(() => {
    if (preference !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setResolved(media.matches ? "dark" : "light");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [preference]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", resolved === "dark");
  }, [resolved]);

  const setPreference = useCallback((next: ThemePreference) => {
    localStorage.setItem(THEME_STORAGE_KEY, next);
    setPreferenceState(next);
    setResolved(resolve(next));
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      preference,
      resolved,
      setPreference,
      toggle: () => setPreference(resolved === "dark" ? "light" : "dark"),
    }),
    [preference, resolved, setPreference],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme precisa estar dentro de ThemeProvider");
  return ctx;
}

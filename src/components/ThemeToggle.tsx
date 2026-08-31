import { Monitor, Moon, Sun } from "lucide-react";
import { useTheme, type ThemePreference } from "@/lib/theme";

const OPTIONS: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
  { value: "light", label: "Claro", icon: Sun },
  { value: "dark", label: "Escuro", icon: Moon },
  { value: "system", label: "Sistema", icon: Monitor },
];

/** Seletor de tema: claro, escuro ou o que o sistema operacional estiver usando. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { preference, setPreference, toggle, resolved } = useTheme();

  if (compact) {
    return (
      <button
        onClick={toggle}
        className="rounded-xl border border-border bg-card p-2 text-muted-foreground shadow-xs transition-colors hover:border-border-strong hover:bg-accent hover:text-foreground"
        aria-label={resolved === "dark" ? "Usar tema claro" : "Usar tema escuro"}
        title={resolved === "dark" ? "Usar tema claro" : "Usar tema escuro"}
      >
        {resolved === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
      </button>
    );
  }

  return (
    <div
      className="flex rounded-xl border border-border bg-secondary p-0.5"
      role="group"
      aria-label="Tema"
    >
      {OPTIONS.map((option) => (
        <button
          key={option.value}
          onClick={() => setPreference(option.value)}
          aria-pressed={preference === option.value}
          title={option.label}
          className={`rounded-lg px-2 py-1.5 transition-all ${
            preference === option.value
              ? "bg-card text-primary shadow-xs ring-1 ring-border"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          <option.icon className="size-3.5" />
          <span className="sr-only">{option.label}</span>
        </button>
      ))}
    </div>
  );
}

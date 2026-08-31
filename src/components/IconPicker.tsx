import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { ICON_GROUPS, IconBadge, iconNameOf } from "@/lib/icons";
import { cn } from "@/lib/utils";

/**
 * Seletor do ícone de uma categoria, espaço ou quadro.
 *
 * Abre num popover em vez de ocupar o formulário inteiro — são quase oitenta
 * desenhos, e a grade toda aberta afogava os outros campos. A busca casa com o
 * rótulo em português ("mercado", "academia", "gasolina"), não com o nome
 * técnico do ícone, que ninguém conhece de cor.
 */
export function IconPicker({
  value,
  onChange,
  color,
  fallback,
  className,
}: {
  value: string | null | undefined;
  onChange: (name: string) => void;
  /** Cor do item, para o ícone aparecer já na cor final. */
  color?: string | null | undefined;
  fallback?: string | undefined;
  className?: string | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const selected = iconNameOf(value, fallback);

  const groups = useMemo(() => {
    const term = query
      .trim()
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "");
    if (!term) return ICON_GROUPS;
    return ICON_GROUPS.map((group) => ({
      ...group,
      icons: group.icons.filter((entry) =>
        `${entry.label} ${entry.name}`
          .toLowerCase()
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .includes(term),
      ),
    })).filter((group) => group.icons.length > 0);
  }, [query]);

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setQuery("");
      }}
    >
      <PopoverTrigger
        className={cn(
          "flex h-11 w-full items-center gap-3 rounded-xl border border-input bg-card px-3 text-left text-sm font-medium shadow-xs transition-colors hover:border-border-strong hover:bg-accent/40",
          className,
        )}
      >
        <IconBadge name={selected} color={color} size="sm" fallback={fallback} />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">Escolher ícone</span>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-0">
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Buscar: mercado, academia, salário…"
              className="h-9 pl-8"
            />
          </div>
        </div>
        <div className="thin-scrollbar max-h-72 overflow-y-auto p-2">
          {groups.length === 0 && (
            <p className="px-1 py-6 text-center text-xs text-muted-foreground">
              Nenhum ícone com esse nome.
            </p>
          )}
          {groups.map((group) => (
            <div key={group.label} className="mb-2 last:mb-0">
              <p className="label-caps px-1 pb-1.5 pt-1">{group.label}</p>
              <div className="grid grid-cols-8 gap-1">
                {group.icons.map((entry) => {
                  const Icon = entry.icon;
                  const active = entry.name === selected;
                  return (
                    <button
                      key={entry.name}
                      type="button"
                      title={entry.label}
                      aria-label={entry.label}
                      aria-pressed={active}
                      onClick={() => {
                        onChange(entry.name);
                        setOpen(false);
                        setQuery("");
                      }}
                      className={cn(
                        "relative flex size-8 items-center justify-center rounded-lg border transition-all",
                        active
                          ? "border-primary bg-primary-soft text-primary shadow-xs"
                          : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-foreground",
                      )}
                    >
                      <Icon className="size-4" />
                      {active && (
                        <Check className="absolute -right-0.5 -top-0.5 size-3 rounded-full bg-primary p-px text-primary-foreground" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}

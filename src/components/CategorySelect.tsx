import * as React from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { DEFAULT_CATEGORY_ICON, IconBadge } from "@/lib/icons";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/data";

/**
 * Escolha de categoria com busca.
 *
 * O `<select>` nativo obriga a percorrer a lista com o olho, e o teclado só
 * ajuda com o prefixo exato: quem tem quarenta categorias e procura "Energia
 * elétrica" precisa acertar o "E" e ir batendo até passar por "Educação". A
 * busca resolve por qualquer pedaço do nome, e no celular substitui uma roda de
 * quarenta itens por uma lista que se filtra.
 *
 * A comparação ignora acento de propósito: quem digita "agua" quer achar
 * "Água", e ninguém deveria precisar do acento certo para filtrar.
 */

/** Sem acento e em minúsculas, para "agua" achar "Água". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export type CategorySelectProps = {
  categories: Category[];
  value: string;
  onChange: (id: string) => void;
  /** Texto do estado vazio. Num filtro é "Todas as categorias". */
  placeholder?: string;
  /** Oferece a opção vazia dentro da lista — filtros sim, formulários não. */
  allowEmpty?: boolean;
  /** `sm` para as linhas densas da importação; `md` para formulários. */
  size?: "sm" | "md";
  disabled?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  /** Marca o campo como pendente (importação com linha sem categoria). */
  invalid?: boolean;
};

export function CategorySelect({
  categories,
  value,
  onChange,
  placeholder = "Escolha uma categoria…",
  allowEmpty = false,
  size = "md",
  disabled,
  className,
  id,
  invalid,
  ...rest
}: CategorySelectProps) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");

  const selected = categories.find((c) => c.id === value) ?? null;
  const found = React.useMemo(() => {
    const needle = fold(term);
    if (!needle) return categories;
    return categories.filter((c) => fold(c.name).includes(needle));
  }, [categories, term]);

  // A busca começa limpa a cada abertura: o termo da vez passada não é o que
  // se procura agora, e vê-la filtrada por engano parece lista vazia.
  React.useEffect(() => {
    if (!open) setTerm("");
  }, [open]);

  function pick(id: string) {
    onChange(id);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        id={id}
        type="button"
        disabled={disabled}
        className={cn(
          "flex w-full items-center gap-2 rounded-xl border bg-card text-left shadow-xs outline-none transition-colors",
          "hover:border-border-strong focus:border-primary focus:ring-2 focus:ring-ring/25",
          "disabled:cursor-not-allowed disabled:opacity-60",
          size === "sm" ? "h-8 rounded-md px-2 text-xs" : "h-11 px-3 text-sm font-medium",
          invalid ? "border-negative/60" : "border-input",
          className,
        )}
        {...rest}
      >
        {selected ? (
          <>
            {size === "md" && (
              <IconBadge
                name={selected.emoji}
                color={selected.color}
                size="sm"
                fallback={DEFAULT_CATEGORY_ICON}
              />
            )}
            {size === "sm" && (
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: selected.color }}
                aria-hidden
              />
            )}
            <span className="min-w-0 flex-1 truncate">{selected.name}</span>
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder}</span>
        )}
        <ChevronDown className="size-3.5 shrink-0 opacity-50" />
      </PopoverTrigger>

      <PopoverContent
        align="start"
        collisionPadding={12}
        // Largura do próprio gatilho: a lista abre exatamente sobre o campo, e
        // não como um painel solto de tamanho arbitrário.
        className="w-(--radix-popover-trigger-width) min-w-56 p-0"
      >
        <div className="flex items-center gap-2 border-b border-border px-3">
          <Search className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            autoFocus
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => {
              // Enter com um único resultado escolhe direto: é o caminho de quem
              // digitou três letras sabendo o que queria.
              if (e.key === "Enter" && found.length === 1) {
                e.preventDefault();
                pick(found[0]!.id);
              }
            }}
            placeholder="Buscar categoria…"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            aria-label="Buscar categoria"
          />
          {term && (
            <button
              type="button"
              onClick={() => setTerm("")}
              aria-label="Limpar busca"
              className="rounded p-1 text-muted-foreground transition-colors hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="max-h-64 overflow-y-auto overflow-x-hidden p-1">
          {allowEmpty && !term && (
            <button
              type="button"
              onClick={() => pick("")}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <span className="min-w-0 flex-1 truncate text-muted-foreground">{placeholder}</span>
              {!value && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          )}

          {found.map((category) => (
            <button
              key={category.id}
              type="button"
              onClick={() => pick(category.id)}
              className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <IconBadge
                name={category.emoji}
                color={category.color}
                size="sm"
                fallback={DEFAULT_CATEGORY_ICON}
              />
              <span className="min-w-0 flex-1 truncate">{category.name}</span>
              {category.id === value && <Check className="size-3.5 shrink-0 text-primary" />}
            </button>
          ))}

          {found.length === 0 && (
            <p className="px-2 py-6 text-center text-xs text-muted-foreground">
              Nenhuma categoria com “{term}”.
            </p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

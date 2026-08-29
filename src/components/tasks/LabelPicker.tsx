import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Check, Plus, Tag, Trash2, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useDeleteLabel,
  useSaveLabel,
  type Label as TaskLabelRow,
  type TaskLabel,
} from "@/lib/tasks";
import { useTone } from "@/hooks/use-tone";
import { LABEL_PALETTE } from "@/lib/tasks-analytics";

/**
 * O chip usa as cores do tema (borda e texto), e o tom escolhido fica só no
 * pontinho — assim a etiqueta continua legível nos dois temas e o tom ainda
 * distingue uma etiqueta da outra.
 */
export function LabelChip({
  label,
  onRemove,
  className = "",
}: {
  label: TaskLabel;
  onRemove?: () => void;
  className?: string;
}) {
  const tone = useTone();
  return (
    <span
      className={`inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium ${className}`}
      title={label.name}
    >
      <span
        className="size-1.5 shrink-0 rounded-full ring-1 ring-border"
        style={{ backgroundColor: tone(label.color) }}
      />
      <span className="truncate">{label.name}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
          aria-label={`Remover etiqueta ${label.name}`}
        >
          <X className="size-2.5" />
        </button>
      )}
    </span>
  );
}

/**
 * Seleção das etiquetas de uma tarefa, com criação inline: digitar um nome que
 * ainda não existe oferece criá-lo sem sair do diálogo da tarefa.
 */
export function LabelPicker({
  accountId,
  labels,
  value,
  onChange,
  disabled = false,
}: {
  accountId: string | null;
  /** Todas as etiquetas da conta. */
  labels: TaskLabelRow[];
  /** Ids das etiquetas selecionadas. */
  value: string[];
  onChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState("");
  const tone = useTone();
  const save = useSaveLabel(accountId);
  const remove = useDeleteLabel();
  // Índice do próximo tom da paleta, para etiquetas novas não saírem todas iguais.
  const nextTone = useRef(0);

  const selected = useMemo(
    () => labels.filter((label) => value.includes(label.id)),
    [labels, value],
  );

  const filtered = useMemo(() => {
    const t = term.trim().toLowerCase();
    return t ? labels.filter((label) => label.name.toLowerCase().includes(t)) : labels;
  }, [labels, term]);

  const exactMatch = labels.some((label) => label.name.toLowerCase() === term.trim().toLowerCase());

  function toggle(id: string) {
    onChange(value.includes(id) ? value.filter((x) => x !== id) : [...value, id]);
  }

  async function createFromTerm() {
    const name = term.trim();
    if (!name) return;
    try {
      const color = LABEL_PALETTE[nextTone.current++ % LABEL_PALETTE.length]!;
      const id = await save.mutateAsync({ name, color });
      if (!value.includes(id)) onChange([...value, id]);
      setTerm("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a etiqueta");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {selected.map((label) => (
          <LabelChip
            key={label.id}
            label={label}
            {...(disabled ? {} : { onRemove: () => toggle(label.id) })}
          />
        ))}
        {selected.length === 0 && (
          <span className="text-xs text-muted-foreground">Nenhuma etiqueta</span>
        )}
      </div>

      {!disabled && (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              <Tag className="size-3.5" /> Etiquetas
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72 p-2">
            <Input
              autoFocus
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && term.trim() && !exactMatch) {
                  e.preventDefault();
                  void createFromTerm();
                }
              }}
              placeholder="Buscar ou criar etiqueta…"
              className="h-8 text-xs"
            />

            <div className="mt-2 max-h-56 space-y-0.5 overflow-y-auto thin-scrollbar">
              {filtered.map((label) => {
                const active = value.includes(label.id);
                return (
                  <div key={label.id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => toggle(label.id)}
                      className="flex flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary"
                    >
                      <span
                        className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
                        style={{ backgroundColor: tone(label.color) }}
                      />
                      <span className="flex-1 truncate">{label.name}</span>
                      {active && <Check className="size-3.5 shrink-0" />}
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        await remove.mutateAsync(label.id);
                        onChange(value.filter((x) => x !== label.id));
                      }}
                      className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
                      aria-label={`Excluir etiqueta ${label.name} da conta`}
                      title="Excluir da conta"
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </div>
                );
              })}

              {filtered.length === 0 && !term.trim() && (
                <p className="px-2 py-3 text-center text-xs text-muted-foreground">
                  Nenhuma etiqueta na conta ainda.
                </p>
              )}
            </div>

            {term.trim() && !exactMatch && (
              <button
                type="button"
                onClick={createFromTerm}
                disabled={save.isPending}
                className="mt-1 flex w-full items-center gap-2 rounded-md border border-border px-2 py-1.5 text-xs transition-colors hover:bg-secondary"
              >
                <Plus className="size-3.5" /> Criar “{term.trim()}”
              </button>
            )}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

/** Filtro por etiqueta usado nas listagens e no Kanban. */
export function LabelFilter({
  labels,
  value,
  onChange,
}: {
  labels: TaskLabelRow[];
  value: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const tone = useTone();
  if (labels.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-sm transition-colors ${
            value.length > 0
              ? "border-foreground bg-secondary text-foreground"
              : "border-input text-muted-foreground hover:text-foreground"
          }`}
        >
          <Tag className="size-3.5" />
          {value.length > 0
            ? `${value.length} etiqueta${value.length > 1 ? "s" : ""}`
            : "Etiquetas"}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-2">
        <div className="max-h-64 space-y-0.5 overflow-y-auto thin-scrollbar">
          {labels.map((label) => {
            const active = value.includes(label.id);
            return (
              <button
                key={label.id}
                type="button"
                onClick={() =>
                  onChange(active ? value.filter((x) => x !== label.id) : [...value, label.id])
                }
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors hover:bg-secondary"
              >
                <span
                  className="size-2.5 shrink-0 rounded-full ring-1 ring-border"
                  style={{ backgroundColor: tone(label.color) }}
                />
                <span className="flex-1 truncate">{label.name}</span>
                {active && <Check className="size-3.5 shrink-0" />}
              </button>
            );
          })}
        </div>
        {value.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="mt-1 w-full rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            Limpar filtro
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}

import { Flag } from "lucide-react";
import { PRIORITIES, priorityOf, type Priority } from "@/lib/tasks-analytics";

/**
 * Selo de prioridade do cartão e da lista: sempre o nome por extenso e a cor da
 * urgência, que é o que se lê de longe num quadro cheio.
 */
export function PriorityBadge({
  priority,
  className = "",
}: {
  priority: Priority;
  className?: string;
}) {
  const config = priorityOf(priority);
  if (priority === "none") return null;

  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold ${config.chip} ${className}`}
      title={`Prioridade: ${config.label}`}
    >
      <Flag className="size-2.5 shrink-0" />
      {config.label}
    </span>
  );
}

/** Escolha da prioridade no formulário da tarefa. */
export function PrioritySelect({
  value,
  onChange,
  disabled = false,
}: {
  value: Priority;
  onChange: (next: Priority) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-1" role="group" aria-label="Prioridade">
      {PRIORITIES.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all disabled:opacity-50 ${
              active
                ? "border-primary bg-primary-soft font-bold text-primary-soft-foreground shadow-xs"
                : "border-border text-muted-foreground hover:border-border-strong hover:bg-accent hover:text-foreground"
            }`}
          >
            <span className={`size-2.5 rounded-full ${option.dot}`} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

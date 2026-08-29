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
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors disabled:opacity-50 ${
              active
                ? "border-foreground bg-secondary font-semibold text-foreground"
                : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <span className={`size-2 rounded-full ${option.dot}`} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

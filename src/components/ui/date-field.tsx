import * as React from "react";
import { CalendarDays, Clock, Eraser } from "lucide-react";
import { ptBR } from "date-fns/locale";

import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Campo de data (e hora) do sistema.
 *
 * O `<input type="date">` nativo tinha dois defeitos que apareciam em todas as
 * telas: obrigava a digitar no formato do navegador — que muda com o idioma do
 * sistema, não com o do app — e abria um calendário desenhado pelo sistema
 * operacional, alheio ao resto da interface.
 *
 * Aqui a data é um campo de texto comum, em português: dá para **digitar**
 * `31/12/2026 18:30` direto, com as barras e os dois-pontos entrando sozinhos
 * conforme os números são digitados. O botão à direita abre o calendário do
 * próprio design system, com atalhos ("hoje", "amanhã") e, nos campos com
 * horário, um seletor de hora ao lado.
 *
 * O contrato com quem usa não mudou: `value` continua sendo o texto ISO que o
 * input nativo produzia (`2026-12-31` ou `2026-12-31T18:30`) e `onChange`
 * continua recebendo algo com `event.target.value`. Trocar o componente não
 * pediu mudança em nenhum formulário.
 */

export type DateFieldType = "date" | "datetime-local" | "month" | "time" | "week";

/** O mínimo do evento de mudança que os formulários realmente leem. */
export type DateFieldChangeEvent = { target: { value: string } };

// ---------------------------------------------------------------------------
// Conversão entre o texto digitado e o valor ISO
// ---------------------------------------------------------------------------

/** Quantos dígitos uma data completa tem, por tipo de campo. */
const DIGITS: Record<"date" | "datetime-local" | "time", number> = {
  date: 8,
  "datetime-local": 12,
  time: 4,
};

const PLACEHOLDER: Record<"date" | "datetime-local" | "time", string> = {
  date: "dd/mm/aaaa",
  "datetime-local": "dd/mm/aaaa hh:mm",
  time: "hh:mm",
};

/** Só os dígitos do que foi digitado, cortados no tamanho do campo. */
function digitsOf(text: string, type: keyof typeof DIGITS): string {
  return text.replace(/\D/g, "").slice(0, DIGITS[type]);
}

/**
 * Põe as barras e os dois-pontos entre os dígitos, à medida que eles chegam.
 * Só insere o separador depois que o grupo anterior fechou, senão apagar o
 * último dígito faria o separador voltar sozinho e travar o backspace.
 */
function maskDigits(digits: string, type: keyof typeof DIGITS): string {
  if (type === "time") {
    return digits.length > 2 ? `${digits.slice(0, 2)}:${digits.slice(2)}` : digits;
  }
  let out = digits.slice(0, 2);
  if (digits.length > 2) out += `/${digits.slice(2, 4)}`;
  if (digits.length > 4) out += `/${digits.slice(4, 8)}`;
  if (type === "datetime-local") {
    if (digits.length > 8) out += ` ${digits.slice(8, 10)}`;
    if (digits.length > 10) out += `:${digits.slice(10, 12)}`;
  }
  return out;
}

/** A data existe mesmo? Rejeita 31/02 e afins, que a `Date` corrige em silêncio. */
function isRealDate(year: number, month: number, day: number): boolean {
  if (year < 1000 || month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(year, month - 1, day);
  return probe.getFullYear() === year && probe.getMonth() === month - 1 && probe.getDate() === day;
}

/**
 * Dígitos completos -> valor ISO. Devolve `null` enquanto o que foi digitado
 * não formar uma data válida — o campo então segura o texto e não avisa
 * ninguém, para não zerar o formulário no meio da digitação.
 */
function digitsToValue(digits: string, type: keyof typeof DIGITS): string | null {
  if (digits.length !== DIGITS[type]) return null;

  if (type === "time") {
    const hour = Number(digits.slice(0, 2));
    const minute = Number(digits.slice(2, 4));
    if (hour > 23 || minute > 59) return null;
    return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
  }

  const day = Number(digits.slice(0, 2));
  const month = Number(digits.slice(2, 4));
  const year = Number(digits.slice(4, 8));
  if (!isRealDate(year, month, day)) return null;
  const date = `${digits.slice(4, 8)}-${digits.slice(2, 4)}-${digits.slice(0, 2)}`;
  if (type === "date") return date;

  const hour = Number(digits.slice(8, 10));
  const minute = Number(digits.slice(10, 12));
  if (hour > 23 || minute > 59) return null;
  return `${date}T${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
}

/** Valor ISO -> texto na tela. */
function valueToText(value: string, type: keyof typeof DIGITS): string {
  if (!value) return "";
  if (type === "time") return value.slice(0, 5);
  const [datePart, timePart = ""] = value.split("T");
  const [year, month, day] = (datePart ?? "").split("-");
  if (!year || !month || !day) return "";
  const base = `${day}/${month}/${year}`;
  if (type === "date") return base;
  return timePart ? `${base} ${timePart.slice(0, 5)}` : base;
}

/** Valor ISO -> `Date` local, para o calendário destacar o dia escolhido. */
function valueToDate(value: string, type: keyof typeof DIGITS): Date | undefined {
  if (type === "time" || !value) return undefined;
  const [datePart] = value.split("T");
  const [year, month, day] = (datePart ?? "").split("-").map(Number);
  if (!year || !month || !day || !isRealDate(year, month, day)) return undefined;
  return new Date(year, month - 1, day);
}

const pad = (n: number) => String(n).padStart(2, "0");
const dateToISO = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Hora atual arredondada para a próxima meia hora — bom padrão para prazos. */
function nextHalfHour(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() > 30 ? 60 : 30, 0, 0);
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// ---------------------------------------------------------------------------
// Campo
// ---------------------------------------------------------------------------

export type DateFieldProps = {
  type?: DateFieldType;
  value?: string;
  onChange?: (event: DateFieldChangeEvent) => void;
  /** Vai para o quadro do campo — é ele que recebe altura, largura e grid. */
  className?: string;
  id?: string;
  name?: string;
  disabled?: boolean;
  readOnly?: boolean;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
};

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(function DateField(
  {
    type = "date",
    value = "",
    onChange,
    className,
    disabled,
    readOnly,
    placeholder,
    autoFocus,
    onBlur,
    ...rest
  },
  ref,
) {
  // `month` e `week` não têm equivalente digitável em português; nenhum
  // formulário do app os usa, e o input nativo continua atendendo quem usar.
  const masked: keyof typeof DIGITS = type === "datetime-local" || type === "time" ? type : "date";
  const isNative = type === "month" || type === "week";

  const withTime = masked === "datetime-local";
  const [text, setText] = React.useState(() => valueToText(value, masked));
  const [open, setOpen] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  React.useImperativeHandle(ref, () => inputRef.current as HTMLInputElement);

  // O valor pode mudar por fora (rascunho carregado, atalho do calendário,
  // outra linha da importação). Reescrevemos o texto sempre que ele não for
  // mais a tradução do valor atual — e nunca no meio de uma digitação válida.
  React.useEffect(() => {
    setText((current) => {
      if (digitsToValue(digitsOf(current, masked), masked) === (value || null)) return current;
      return valueToText(value, masked);
    });
  }, [value, masked]);

  function emit(next: string) {
    onChange?.({ target: { value: next } });
  }

  function handleType(raw: string) {
    const digits = digitsOf(raw, masked);
    setText(maskDigits(digits, masked));
    if (digits.length === 0) {
      if (value) emit("");
      return;
    }
    const parsed = digitsToValue(digits, masked);
    if (parsed && parsed !== value) emit(parsed);
  }

  /** Ao sair do campo, texto pela metade volta ao último valor válido. */
  function handleBlur(event: React.FocusEvent<HTMLInputElement>) {
    const digits = digitsOf(text, masked);
    if (digits.length === 0) {
      setText("");
      if (value) emit("");
    } else if (!digitsToValue(digits, masked)) {
      setText(valueToText(value, masked));
    }
    onBlur?.(event);
  }

  /**
   * Escolha no calendário. Num campo com horário, mantém a hora que já estava
   * (ou propõe a próxima meia hora) — trocar o dia não deveria zerar o horário.
   */
  function pickDate(date: Date | undefined) {
    if (!date) return;
    const iso = dateToISO(date);
    if (!withTime) {
      emit(iso);
      setOpen(false);
      return;
    }
    const time = value.split("T")[1]?.slice(0, 5) || nextHalfHour();
    emit(`${iso}T${time}`);
  }

  function pickTime(time: string) {
    const day = value.split("T")[0] || dateToISO(new Date());
    emit(`${day}T${time}`);
  }

  if (isNative) {
    return (
      <input
        ref={inputRef}
        type={type}
        value={value}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        onChange={(e) => emit(e.target.value)}
        onBlur={onBlur}
        className={cn(
          "flex h-11 w-full rounded-xl border border-input bg-card px-3 text-sm shadow-xs outline-none transition-colors focus:border-primary",
          className,
        )}
        {...rest}
      />
    );
  }

  const selected = valueToDate(value, masked);
  const time = withTime ? (value.split("T")[1]?.slice(0, 5) ?? "") : "";

  return (
    <div
      data-disabled={disabled || undefined}
      className={cn(
        "group flex h-11 w-full items-center rounded-xl border border-input bg-card shadow-xs transition-colors",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-ring/25",
        "data-disabled:cursor-not-allowed data-disabled:opacity-60",
        className,
      )}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        autoComplete="off"
        value={text}
        disabled={disabled}
        readOnly={readOnly}
        autoFocus={autoFocus}
        placeholder={placeholder ?? PLACEHOLDER[masked]}
        onChange={(e) => handleType(e.target.value)}
        onBlur={handleBlur}
        className="h-full min-w-0 flex-1 rounded-l-[inherit] bg-transparent px-3 font-mono text-[0.9em] tracking-tight text-foreground outline-none placeholder:font-sans placeholder:tracking-normal placeholder:text-muted-foreground/70 disabled:cursor-not-allowed"
        {...rest}
      />

      {masked === "time" ? null : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            type="button"
            disabled={disabled || readOnly}
            aria-label="Abrir calendário"
            className="mr-1 flex h-[calc(100%-0.5rem)] items-center rounded-lg px-2 text-muted-foreground transition-colors hover:bg-primary-soft hover:text-primary disabled:pointer-events-none"
          >
            <CalendarDays className="size-4" />
          </PopoverTrigger>
          <PopoverContent align="end" className="w-auto p-0">
            <div className="flex flex-col sm:flex-row">
              <div className="p-2">
                <Calendar
                  mode="single"
                  locale={ptBR}
                  onSelect={pickDate}
                  autoFocus
                  {...(selected ? { selected, defaultMonth: selected } : {})}
                />
              </div>
              <div className="flex flex-col gap-1 border-t border-border p-2 sm:w-44 sm:border-l sm:border-t-0">
                <p className="label-caps px-1 pb-1">Atalhos</p>
                {SHORTCUTS.map((shortcut) => (
                  <button
                    key={shortcut.label}
                    type="button"
                    onClick={() => {
                      pickDate(shortcut.date());
                      if (!withTime) setOpen(false);
                    }}
                    className="rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  >
                    {shortcut.label}
                  </button>
                ))}

                {withTime && (
                  <div className="mt-1 border-t border-border pt-2">
                    <p className="label-caps px-1 pb-1.5">Horário</p>
                    <div className="flex items-center gap-2 rounded-lg border border-input px-2">
                      <Clock className="size-3.5 shrink-0 text-muted-foreground" />
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="hh:mm"
                        value={time}
                        onChange={(e) => {
                          const digits = digitsOf(e.target.value, "time");
                          const parsed = digitsToValue(digits, "time");
                          if (parsed) pickTime(parsed);
                          else if (digits.length === 0 && selected) pickTime("00:00");
                        }}
                        className="h-8 w-full bg-transparent font-mono text-xs outline-none placeholder:font-sans placeholder:text-muted-foreground/70"
                      />
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-1">
                      {["08:00", "12:00", "18:00"].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => pickTime(preset)}
                          className="rounded-md border border-border py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary hover:bg-primary-soft hover:text-primary"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  onClick={() => {
                    emit("");
                    setOpen(false);
                  }}
                  className="mt-1 flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-negative-soft hover:text-negative-soft-foreground"
                >
                  <Eraser className="size-3.5" /> Limpar
                </button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
});

/** Atalhos do calendário — os saltos que aparecem em quase todo formulário. */
const SHORTCUTS: Array<{ label: string; date: () => Date }> = [
  { label: "Hoje", date: () => new Date() },
  {
    label: "Amanhã",
    date: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      return d;
    },
  },
  {
    label: "Em uma semana",
    date: () => {
      const d = new Date();
      d.setDate(d.getDate() + 7);
      return d;
    },
  },
  {
    label: "Em um mês",
    date: () => {
      const d = new Date();
      d.setMonth(d.getMonth() + 1);
      return d;
    },
  },
];

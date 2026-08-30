import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * Campos de data que abrem o calendário ao clique.
 *
 * Dois problemas do `<input type="date">` puro moram aqui:
 *
 *   1. O ícone nativo é desenhado em preto fixo e sumia no tema escuro. O
 *      contraste é devolvido no `styles.css`, que inverte o ícone no escuro.
 *   2. Só o ícone abria o calendário — clicar no campo apenas punha o cursor
 *      num pedaço da data. `showPicker()` faz o clique em qualquer ponto abrir.
 *
 * `showPicker()` existe em todos os navegadores atuais; onde não existir (ou
 * quando o navegador recusa por falta de gesto do usuário), o campo continua
 * funcionando como antes — daí o try/catch em vez de checagem de versão.
 */
function openPicker(element: HTMLInputElement): void {
  if (element.disabled || element.readOnly) return;
  try {
    element.showPicker?.();
  } catch {
    // Navegador que recusa a abertura programática: o campo segue editável e o
    // ícone nativo continua abrindo o calendário.
  }
}

/**
 * Handlers de abertura para um `<input type="date">` com estilo próprio, que
 * não passa pelo `Input` do design system. Quem usa o `DateField` já os tem.
 */
export function datePickerProps(): Pick<React.ComponentProps<"input">, "onClick" | "onKeyDown"> {
  return {
    onClick: (event) => openPicker(event.currentTarget),
    onKeyDown: (event) => {
      // Teclado: Enter ou seta para baixo abrem, como em qualquer seletor.
      if (event.key === "Enter" || event.key === "ArrowDown") {
        event.preventDefault();
        openPicker(event.currentTarget);
      }
    },
  };
}

export type DateFieldProps = Omit<React.ComponentProps<"input">, "type"> & {
  type?: "date" | "datetime-local" | "month" | "time" | "week";
};

export const DateField = React.forwardRef<HTMLInputElement, DateFieldProps>(
  ({ type = "date", onClick, onKeyDown, ...props }, ref) => {
    const handlers = datePickerProps();

    return (
      <Input
        ref={ref}
        type={type}
        onClick={(event) => {
          onClick?.(event);
          if (!event.defaultPrevented) handlers.onClick?.(event);
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (!event.defaultPrevented) handlers.onKeyDown?.(event);
        }}
        {...props}
      />
    );
  },
);
DateField.displayName = "DateField";

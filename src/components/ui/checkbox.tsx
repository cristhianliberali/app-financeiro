import * as React from "react";
import * as CheckboxPrimitive from "@radix-ui/react-checkbox";
import { Check, Minus } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Caixa de seleção.
 *
 * O estado indeterminado — "algumas das linhas abaixo" — desenha um traço, não
 * o visto: com o mesmo visto do estado marcado, a caixa do cabeçalho de uma
 * lista parcialmente selecionada mentia, dizendo que tudo estava escolhido.
 */
const Checkbox = React.forwardRef<
  React.ElementRef<typeof CheckboxPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof CheckboxPrimitive.Root>
>(({ className, ...props }, ref) => (
  <CheckboxPrimitive.Root
    ref={ref}
    className={cn(
      "group grid place-content-center peer size-[1.15rem] shrink-0 rounded-[6px] border-2 border-border-strong shadow-xs cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 hover:border-primary disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground data-[state=checked]:shadow-glow data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary-soft data-[state=indeterminate]:text-primary",
      className,
    )}
    {...props}
  >
    <CheckboxPrimitive.Indicator className={cn("grid place-content-center text-current")}>
      <Check className="size-3.5 group-data-[state=indeterminate]:hidden" strokeWidth={3} />
      <Minus className="hidden size-3.5 group-data-[state=indeterminate]:block" strokeWidth={3} />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>
));
Checkbox.displayName = CheckboxPrimitive.Root.displayName;

export { Checkbox };

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Botão do design system.
 *
 * Três níveis de ênfase, e a tela deve usar um de cada vez: `brand` (gradiente)
 * para a ação principal, `default` (violeta cheio) para as demais ações
 * afirmativas, e `outline`/`ghost` para o que apenas acompanha. O clique afunda
 * 1px — o retorno tátil que faltava — e o foco desenha o anel da marca.
 */
const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap font-semibold cursor-pointer",
    "transition-[background-color,border-color,color,box-shadow,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:shadow-md",
        brand: "brand-gradient shadow-sm hover:shadow-glow",
        destructive:
          "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90 hover:shadow-md",
        outline:
          "border border-input bg-card text-foreground shadow-xs hover:border-border-strong hover:bg-accent hover:text-accent-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-xs hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        soft: "bg-primary-soft text-primary-soft-foreground hover:bg-primary/15",
        link: "text-primary underline-offset-4 hover:underline",
        ink: "bg-ink text-ink-foreground shadow-sm hover:bg-ink/90 hover:shadow-md",
      },
      size: {
        default: "h-10 rounded-xl px-4 text-sm",
        sm: "h-9 rounded-lg px-3 text-xs",
        xs: "h-7 rounded-lg px-2 text-[11px] [&_svg]:size-3.5",
        lg: "h-12 rounded-xl px-7 text-base",
        icon: "size-10 rounded-xl",
        "icon-sm": "size-8 rounded-lg [&_svg]:size-3.5",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };

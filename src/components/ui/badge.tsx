import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

/**
 * Selo de estado.
 *
 * As variantes semânticas (`positive`, `negative`, `warning`, `info`) usam o
 * par suave da cor — fundo lavado, texto e borda saturados. Cor cheia em selo
 * competiria com os botões pela atenção; suave, o selo informa sem gritar.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors [&_svg]:size-3 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "border-transparent bg-primary text-primary-foreground shadow-xs",
        soft: "border-primary/25 bg-primary-soft text-primary-soft-foreground",
        secondary: "border-border bg-secondary text-secondary-foreground",
        outline: "border-border text-muted-foreground",
        positive: "border-positive/30 bg-positive-soft text-positive-soft-foreground",
        negative: "border-negative/30 bg-negative-soft text-negative-soft-foreground",
        warning: "border-warning/35 bg-warning-soft text-warning-soft-foreground",
        info: "border-info/30 bg-info-soft text-info-soft-foreground",
        destructive: "border-transparent bg-destructive text-destructive-foreground shadow-xs",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>, VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };

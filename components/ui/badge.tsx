import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-primary-400/30",
  {
    variants: {
      variant: {
        default:
          "border-primary-200 bg-primary-100/70 text-primary-700",
        secondary:
          "border-secondary-200 bg-secondary-100/70 text-secondary-700",
        success:
          "border-success-200 bg-success-100/70 text-success-700",
        warning:
          "border-warning-200 bg-warning-100/70 text-warning-700",
        destructive:
          "border-destructive-200 bg-destructive-100/70 text-destructive-700",
        outline:
          "text-foreground border-border bg-transparent",
        ghost:
          "border-transparent bg-primary-50/60 text-primary-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  );
}

export { Badge, badgeVariants };

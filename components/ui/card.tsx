import * as React from "react";
import { cn } from "@/lib/utils";

const Card = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "hover-lift rounded-2xl border border-ink/10 bg-cream-soft p-6 shadow-[0_1px_0_0_rgba(21,23,15,0.04)] hover:border-leaf-300 dark:border-night-border dark:bg-night-soft dark:shadow-none dark:hover:border-leaf-600",
        className
      )}
      {...props}
    />
  )
);
Card.displayName = "Card";

export { Card };

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-pill font-display font-semibold transition-all duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 focus-ring disabled:pointer-events-none disabled:opacity-50 disabled:hover:translate-y-0",
  {
    variants: {
      variant: {
        primary: "bg-ink text-cream shadow-sm hover:bg-gradient-to-r hover:from-ink hover:to-ink-soft hover:shadow-lg hover:shadow-ink/20",
        accent: "bg-leaf-500 text-ink shadow-sm hover:bg-gradient-to-r hover:from-leaf-500 hover:to-leaf-700 hover:text-cream hover:shadow-lg hover:shadow-leaf-600/30",
        outline: "border-2 border-ink text-ink hover:bg-gradient-to-r hover:from-ink hover:to-ink-soft hover:text-cream hover:shadow-lg hover:shadow-ink/10 dark:border-cream/25 dark:text-cream dark:hover:from-leaf-600 dark:hover:to-leaf-700 dark:hover:border-transparent",
        ghost: "text-ink hover:bg-gradient-to-r hover:from-leaf-100 hover:to-leaf-300/60 hover:shadow-sm",
      },
      size: {
        default: "h-12 px-6 text-[15px]",
        sm: "h-10 px-4 text-sm",
        lg: "h-14 px-8 text-base",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };

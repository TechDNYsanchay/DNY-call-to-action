import clsx from "clsx";
import type { ButtonHTMLAttributes, ReactNode } from "react";

// One button recipe for every screen. Primary = ink, secondary = sheet with a strong border,
// ghost = text only, danger = signal text. 44 px targets on phone ("lg" sizes drop to 36 on desktop).

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-ink text-sheet hover:bg-ink/90 disabled:bg-ink/50",
  secondary: "bg-sheet text-ink border border-strong hover:bg-raised disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-raised hover:text-ink disabled:text-ink-3",
  danger: "text-signal hover:bg-signal-tint disabled:text-ink-3",
};

const SIZES: Record<ButtonSize, string> = {
  sm: "h-8 px-2.5 text-[13px] gap-1.5",
  md: "h-10 px-3.5 text-[14px] gap-2 lg:h-9",
  lg: "h-11 px-4 text-[14px] gap-2",
};

export function buttonClass(variant: ButtonVariant = "secondary", size: ButtonSize = "md", className?: string): string {
  return clsx(
    "inline-flex shrink-0 items-center justify-center rounded-chip font-medium whitespace-nowrap transition-colors duration-150 ease-out-soft select-none disabled:cursor-not-allowed",
    VARIANTS[variant],
    SIZES[size],
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  children: ReactNode;
}

export function Button({ variant = "secondary", size = "md", className, type = "button", children, ...rest }: ButtonProps) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}

/** A 44 px square target for an icon alone; the label is for screen readers. */
export function IconButton({ label, className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={clsx("inline-flex size-11 shrink-0 items-center justify-center rounded-chip text-ink-2 transition-colors duration-150 hover:bg-raised hover:text-ink lg:size-9", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

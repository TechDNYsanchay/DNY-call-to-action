"use client";

import clsx from "clsx";

// An on/off switch: role="switch" with the state in aria-checked, a 44 px target on phones. The label is
// for screen readers; the words next to it are the caller's. `tone` colours the "on" track: bottle for a
// feature that runs, signal for a stop (the pipeline's pause).

export function Switch({
  checked,
  onCheckedChange,
  label,
  disabled,
  tone = "bottle",
  className,
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: "bottle" | "signal";
  className?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={clsx("group inline-flex size-11 shrink-0 items-center justify-center rounded-chip disabled:cursor-not-allowed disabled:opacity-60 lg:h-8 lg:w-12", className)}
    >
      <span
        aria-hidden="true"
        className={clsx(
          "relative inline-flex h-7 w-12 items-center rounded-full border transition-colors duration-150",
          checked ? (tone === "signal" ? "border-signal bg-signal" : "border-bottle bg-bottle") : "border-strong bg-inset group-hover:border-ink-2",
        )}
      >
        <span className={clsx("absolute size-5 rounded-full bg-sheet shadow-card transition-transform duration-150", checked ? "translate-x-[25px]" : "translate-x-[3px]")} />
      </span>
    </button>
  );
}

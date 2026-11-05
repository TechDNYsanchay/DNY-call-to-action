import clsx from "clsx";
import { Check, X } from "@phosphor-icons/react/dist/ssr";
import { type TimelineInput, timelineSteps } from "@/lib/ui/status";

// The five steps a meeting goes through before its sheet exists. An ordered list inside
// aria-live="polite", so a step change is announced once. The active dot pulses (static under
// reduced motion); the failed step shows the plain reason.

export function ProcessingTimeline({ meeting, className }: { meeting: TimelineInput; className?: string }) {
  const steps = timelineSteps(meeting);
  return (
    <div aria-live="polite" className={className}>
      <ol className="flex flex-col">
        {steps.map((step, i) => {
          const last = i === steps.length - 1;
          return (
            <li key={step.key} className="relative flex gap-3 pb-5 last:pb-0">
              {!last && <span aria-hidden="true" className={clsx("absolute top-5 left-[9px] h-[calc(100%-12px)] w-px", step.state === "done" ? "bg-bottle/40" : "bg-hairline")} />}
              <span
                aria-hidden="true"
                className={clsx(
                  "mt-0.5 flex size-[18px] shrink-0 items-center justify-center rounded-full",
                  step.state === "done" && "check-pop bg-bottle text-sheet",
                  step.state === "active" && "border-2 border-slate",
                  step.state === "failed" && "bg-signal text-sheet",
                  step.state === "todo" && "border border-strong",
                )}
              >
                {step.state === "done" && <Check size={11} weight="bold" />}
                {step.state === "failed" && <X size={11} weight="bold" />}
                {step.state === "active" && <span className="pulse-dot size-2 rounded-full bg-slate" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={clsx("text-[15px] leading-[22px] lg:text-[14px] lg:leading-[20px]", step.state === "todo" ? "text-ink-3" : step.state === "failed" ? "font-medium text-signal" : "text-ink", step.state === "active" && "font-medium")}>
                  {step.label}
                  <span className="sr-only">{step.state === "done" ? ", done" : step.state === "active" ? ", in progress" : step.state === "failed" ? ", failed" : ", not yet"}</span>
                </p>
                {step.hint && step.state === "active" && <p className="text-[13px] leading-[18px] text-ink-3">{step.hint}</p>}
                {step.state === "failed" && meeting.failure_reason && <p className="mt-0.5 text-[13px] leading-[18px] text-ink-2 break-words">{meeting.failure_reason}</p>}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

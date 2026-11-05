import { describe, expect, it } from "vitest";
import { confidenceWord, statusTone, statusWord, timelineSteps, typeLabel } from "./status";

describe("status words", () => {
  it("has a word for every status", () => {
    for (const s of ["new", "waiting_transcript", "ready", "processing", "needs_decision", "done", "failed", "skipped"] as const) {
      expect(statusWord(s).length).toBeGreaterThan(0);
    }
    expect(statusTone("done")).toBe("bottle");
    expect(statusTone("failed")).toBe("signal");
    expect(typeLabel("client")).toBe("Client meeting");
  });

  it("only speaks about confidence below the threshold", () => {
    expect(confidenceWord(0.94)).toBeNull();
    expect(confidenceWord(0.62)).toBe("Model is fairly sure (62%)");
    expect(confidenceWord(0.3)).toBe("Model is unsure (30%)");
    expect(confidenceWord(null)).toBeNull();
  });
});

describe("timelineSteps", () => {
  it("waits for the transcript first", () => {
    const steps = timelineSteps({ process_status: "waiting_transcript", type: "client", type_source: "rule", transcript_ready: false });
    expect(steps[0].state).toBe("active");
    expect(steps.slice(1).every((s) => s.state === "todo")).toBe(true);
  });

  it("marks the queue as active when ready", () => {
    const steps = timelineSteps({ process_status: "ready", type: "client", type_source: "rule", transcript_ready: true });
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "active", "todo", "todo"]);
    expect(steps[2].hint).toContain("hourly");
  });

  it("shows analysing while processing and done at the end", () => {
    expect(timelineSteps({ process_status: "processing", type: "client", type_source: "rule", transcript_ready: true })[3].state).toBe("active");
    expect(timelineSteps({ process_status: "done", type: "client", type_source: "human", transcript_ready: true }).every((s) => s.state === "done")).toBe(true);
  });

  it("points at the classification when a decision is needed and at the failure when failed", () => {
    expect(timelineSteps({ process_status: "needs_decision", type: "client", type_source: "llm", transcript_ready: true })[1].state).toBe("active");
    expect(timelineSteps({ process_status: "failed", type: "client", type_source: "rule", transcript_ready: true })[3].state).toBe("failed");
  });
});

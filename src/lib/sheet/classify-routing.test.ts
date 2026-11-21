import { describe, expect, it } from "vitest";
import { matchClientName, routeCallClassification, routeClassification } from "./classify-routing";
import { CALL_CLASS_TYPES } from "./schema";

describe("routeClassification", () => {
  it("continues only for confident client meetings", () => {
    expect(routeClassification("client", 0.9, 0.8)).toEqual({ status: "processing", proceed: true });
    expect(routeClassification("client", 0.8, 0.8)).toEqual({ status: "processing", proceed: true });
    expect(routeClassification("client", 0.79, 0.8)).toEqual({ status: "needs_decision", proceed: false });
  });
  it("skips every non-client type whatever the confidence", () => {
    expect(routeClassification("sales", 0.99, 0.8)).toEqual({ status: "skipped", proceed: false });
    expect(routeClassification("internal", 0.3, 0.8)).toEqual({ status: "skipped", proceed: false });
    expect(routeClassification("other", 0.5, 0.8)).toEqual({ status: "skipped", proceed: false });
  });
});

describe("routeCallClassification", () => {
  it("sends client and vendor calls to the sheet whatever the confidence", () => {
    expect(routeCallClassification("client", 0.3, 0.8)).toEqual({ action: "proceed", type: "client" });
    expect(routeCallClassification("vendor", 0.95, 0.8)).toEqual({ action: "proceed", type: "vendor" });
  });
  it("deletes a call that is not a work call only when the routine is sure", () => {
    expect(routeCallClassification("personal", 0.9, 0.8)).toEqual({ action: "purge", code: "personal" });
    expect(routeCallClassification("personal", 0.8, 0.8)).toEqual({ action: "purge", code: "personal" });
    expect(routeCallClassification("personal", 0.6, 0.8)).toEqual({ action: "hold", kind: "unsure" });
    expect(routeCallClassification("no_content", 0.5, 0.8)).toEqual({ action: "hold", kind: "unsure" });
    expect(routeCallClassification("sales", Number.NaN, 0.8)).toEqual({ action: "hold", kind: "unsure" });
  });
  it("maps each not-work type to its own skip code", () => {
    const notWork = CALL_CLASS_TYPES.filter((t) => t !== "client" && t !== "vendor");
    expect(notWork.map((t) => routeCallClassification(t, 0.99, 0.8))).toEqual([
      { action: "purge", code: "sales" },
      { action: "purge", code: "internal" },
      { action: "purge", code: "personal" },
      { action: "purge", code: "wrong_number" },
      { action: "purge", code: "no_content" },
    ]);
  });
});

describe("matchClientName", () => {
  const clients = [{ id: "1", name: "Saffron Court Hotel" }, { id: "2", name: "Blue Bay Resort" }];
  it("matches case- and whitespace-insensitively", () => {
    expect(matchClientName(" saffron court hotel ", clients)?.id).toBe("1");
    expect(matchClientName("Saffron Court", clients)).toBeNull();
    expect(matchClientName(null, clients)).toBeNull();
    expect(matchClientName("   ", clients)).toBeNull();
  });
});

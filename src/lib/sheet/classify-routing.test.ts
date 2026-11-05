import { describe, expect, it } from "vitest";
import { matchClientName, routeClassification } from "./classify-routing";

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

describe("matchClientName", () => {
  const clients = [{ id: "1", name: "Saffron Court Hotel" }, { id: "2", name: "Blue Bay Resort" }];
  it("matches case- and whitespace-insensitively", () => {
    expect(matchClientName(" saffron court hotel ", clients)?.id).toBe("1");
    expect(matchClientName("Saffron Court", clients)).toBeNull();
    expect(matchClientName(null, clients)).toBeNull();
    expect(matchClientName("   ", clients)).toBeNull();
  });
});

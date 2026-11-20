import { describe, expect, it } from "vitest";

import { isPublicPath, safeNextPath } from "./auth-paths";

describe("isPublicPath", () => {
  it("lets the machine routes through, which check their own secrets", () => {
    expect(isPublicPath("/api/erp/bookings")).toBe(true);
    expect(isPublicPath("/api/erp/action-items")).toBe(true);
    expect(isPublicPath("/api/agent/next")).toBe(true);
    expect(isPublicPath("/api/cron/tick")).toBe(true);
  });

  it("keeps the screens behind sign-in, a lookalike included", () => {
    expect(isPublicPath("/bookings")).toBe(false);
    expect(isPublicPath("/meetings")).toBe(false);
    expect(isPublicPath("/api/erpx")).toBe(false);
  });

  it("never sends a sign-in on to a machine route", () => {
    expect(safeNextPath("/api/erp/bookings")).toBe("/meetings");
  });
});

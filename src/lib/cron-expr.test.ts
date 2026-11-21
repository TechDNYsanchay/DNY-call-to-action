import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isValidVercelCron } from "./cron-expr";

describe("isValidVercelCron", () => {
  it("accepts the forms Vercel documents", () => {
    for (const expr of ["*/2 * * * *", "*/10 * * * *", "30 21 * * *", "0 5 * * 1-5", "0,30 3-17 * * *", "5-55/10 * * * *", "0 0 1 * *", "0 9 * 1,6 0"]) {
      expect(isValidVercelCron(expr), expr).toBe(true);
    }
  });
  it("refuses everything else", () => {
    for (const expr of [
      "* * * *",
      "* * * * * *",
      "60 * * * *",
      "0 24 * * *",
      "0 0 0 * *",
      "0 0 32 * *",
      "0 0 * 13 *",
      "0 0 * * 7",
      "0 0 * JAN *",
      "0 0 * * MON",
      "0 0 L * *",
      "0 0 1W * *",
      "0 0 * * 5#3",
      "0 0 ? * *",
      "0 0 1 * 1",
      "*/0 * * * *",
      "5/10 * * * *",
      "10-5 * * * *",
      "1,,2 * * * *",
      "@hourly",
      "",
    ]) {
      expect(isValidVercelCron(expr), expr).toBe(false);
    }
  });
});

describe("vercel.json", () => {
  it("has only valid cron schedules", () => {
    const config = JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
    expect(config.crons?.length).toBeGreaterThan(0);
    for (const cron of config.crons ?? []) expect(isValidVercelCron(cron.schedule), `${cron.path}: ${cron.schedule}`).toBe(true);
  });
});

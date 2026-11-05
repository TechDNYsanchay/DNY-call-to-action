import { describe, expect, it } from "vitest";
import { ilikePattern, inboxHref, parseInboxQuery, pgQuote } from "./query";

describe("inbox query", () => {
  it("parses with safe defaults", () => {
    expect(parseInboxQuery({})).toEqual({ filter: "all", clientId: null, q: "", page: 1, showSkipped: false });
    expect(parseInboxQuery({ filter: "attention", client: "not-a-uuid", q: "  taj ", page: "3", skipped: "1" })).toEqual({ filter: "attention", clientId: null, q: "taj", page: 3, showSkipped: true });
    expect(parseInboxQuery({ page: "-2" }).page).toBe(1);
    expect(parseInboxQuery({ client: "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d" }).clientId).toBe("6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d");
  });

  it("writes only the non-default parts", () => {
    expect(inboxHref({ filter: "all", page: 1 })).toBe("/meetings");
    expect(inboxHref({ filter: "clients", q: "taj", page: 2 })).toBe("/meetings?filter=clients&q=taj&page=2");
  });

  it("quotes values for PostgREST and ILIKE", () => {
    expect(pgQuote('Priya "P" Nair, GM')).toBe('"Priya \\"P\\" Nair, GM"');
    expect(ilikePattern("100%_x")).toBe("%100\\%\\_x%");
  });
});

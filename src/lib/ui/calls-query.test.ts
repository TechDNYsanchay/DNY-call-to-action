import { describe, expect, it } from "vitest";
import { CALLS_PAGE_SIZE, callsHref, callsSearchOf, isFilteredCalls, pageAfterPinned, parseCallsQuery, sheetFilterCount } from "./calls-query";

const LINE = "6f1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENT = "11111111-1111-4111-8111-111111111111";

describe("calls query", () => {
  it("parses with safe defaults", () => {
    expect(parseCallsQuery({})).toEqual({ filter: "all", lineId: null, clientId: null, q: "", page: 1, showNotWork: false });
    expect(parseCallsQuery({ filter: "vendor", line: LINE, client: "nope", q: "  cafe 89 ", page: "2", notwork: "1" })).toEqual({ filter: "vendor", lineId: LINE, clientId: null, q: "cafe 89", page: 2, showNotWork: true });
    expect(parseCallsQuery({ filter: "attention", page: "0" })).toMatchObject({ filter: "all", page: 1 });
    expect(parseCallsQuery({ filter: ["decide", "client"], client: CLIENT })).toMatchObject({ filter: "decide", clientId: CLIENT });
  });

  it("writes only the non-default parts and round-trips", () => {
    expect(callsHref({ filter: "all", page: 1 })).toBe("/calls");
    const href = callsHref({ filter: "decide", lineId: LINE, q: "rakesh", page: 3, showNotWork: true });
    expect(href).toBe(`/calls?filter=decide&line=${LINE}&q=rakesh&page=3&notwork=1`);
    const back = parseCallsQuery(Object.fromEntries(new URL(href, "https://x").searchParams));
    expect(callsHref(back)).toBe(href);
  });

  it("never writes a number into the URL", () => {
    expect(callsHref({ q: "+91 98201 23456", filter: "client" })).toBe("/calls?filter=client");
    expect(callsHref({ q: "9820123" })).toBe("/calls");
    // Fewer than 7 digits is a text search, as typed.
    expect(callsHref({ q: "98201" })).toBe("/calls?q=98201");
    expect(callsHref({ q: "room 9820123" })).toBe("/calls?q=room+9820123");
  });

  it("knows when the list is filtered", () => {
    expect(isFilteredCalls(parseCallsQuery({}))).toBe(false);
    expect(isFilteredCalls(parseCallsQuery({ notwork: "1" }))).toBe(true);
    expect(sheetFilterCount(parseCallsQuery({ line: LINE, client: CLIENT, filter: "client" }))).toBe(2);
  });
});

describe("callsSearchOf", () => {
  it("treats 7 or more digits as a number search", () => {
    expect(callsSearchOf("98201 23")).toEqual({ kind: "digits", digits: "9820123" });
    expect(callsSearchOf("+91 98201 23456")).toEqual({ kind: "digits", digits: "9820123456" });
    expect(callsSearchOf("098201-23456")).toEqual({ kind: "digits", digits: "9820123456" });
  });

  it("keeps short numbers and words as a text search", () => {
    expect(callsSearchOf("98201")).toEqual({ kind: "text", text: "98201", shortNumber: true });
    expect(callsSearchOf("Cafe 89")).toEqual({ kind: "text", text: "Cafe 89", shortNumber: false });
    expect(callsSearchOf("room 9820123")).toEqual({ kind: "text", text: "room 9820123", shortNumber: false });
    expect(callsSearchOf("   ")).toBeNull();
  });
});

describe("pageAfterPinned", () => {
  const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ id: `c${from + i}` }));

  it("decides paging on the rows as read, before the pinned ones leave", () => {
    // 51 rows read for a page of 50; the three newest are pinned above the list (still moving).
    const page = pageAfterPinned(rows(CALLS_PAGE_SIZE + 1), new Set(["c0", "c1", "c2"]));
    expect(page.hasMore).toBe(true);
    expect(page.rows).toHaveLength(CALLS_PAGE_SIZE - 3);
    // The extra row is the first of page 2, never also on this page.
    expect(page.rows.map((r) => r.id)).not.toContain(`c${CALLS_PAGE_SIZE}`);
    expect(page.rows[page.rows.length - 1].id).toBe(`c${CALLS_PAGE_SIZE - 1}`);
  });

  it("says there is no more when the read came up short", () => {
    expect(pageAfterPinned(rows(CALLS_PAGE_SIZE), new Set(["c0"]))).toMatchObject({ hasMore: false });
    expect(pageAfterPinned(rows(3), new Set())).toEqual({ rows: rows(3), hasMore: false });
  });
});

import { describe, expect, it } from "vitest";
import { type ExistingItem, itemKey, matchItems, sameItem, titleStem } from "./match-items";
import type { ActionItem } from "./schema";

const item = (id: string, title: string, owedBy: ActionItem["owed_by"] = "dny", ts = "12:03"): ActionItem => ({
  id,
  title,
  details: "",
  owed_by: owedBy,
  owner: { name: null, side: "dny", basis: "not_stated" },
  due: { kind: "none_stated", date: null, raw_phrase: null, basis: null },
  priority: "medium",
  linked_decision_id: null,
  evidence: [{ timestamp: ts, speaker: "Arjun Mehta", quote: "x", quote_english: null }],
  confidence: 0.9,
});
const existing = (over: Partial<ExistingItem> & { id: string; title: string }): ExistingItem => ({
  item_key: itemKey("dny", over.title),
  status: "open",
  evidence_ts_sec: 723,
  edited_by: null,
  erp_task_id: null,
  ...over,
});
const tsOf = (i: ActionItem) => {
  const [m, s] = i.evidence[0].timestamp.split(":").map(Number);
  return m * 60 + s;
};

describe("titleStem and itemKey", () => {
  it("ignores filler words, case and punctuation", () => {
    expect(titleStem("Share the revised roster with the owner")).toBe("share revised roster owner");
    expect(itemKey("dny", "Send October MIS!")).toBe(itemKey("dny", "send october mis"));
    expect(itemKey("dny", "Send October MIS")).not.toBe(itemKey("client", "Send October MIS"));
    expect(itemKey("dny", "Send October MIS")).toHaveLength(16);
  });
});

describe("sameItem", () => {
  it("matches on key, or on a nearby timestamp with overlapping title", () => {
    const row = existing({ id: "r1", title: "Send October MIS to the owner" });
    expect(sameItem({ key: row.item_key, title: "anything", tsSec: null }, row)).toBe(true);
    expect(sameItem({ key: "other", title: "Send the October MIS report to owner", tsSec: 740 }, row)).toBe(true);
    expect(sameItem({ key: "other", title: "Send the October MIS report to owner", tsSec: 900 }, row)).toBe(false);
    expect(sameItem({ key: "other", title: "Approve exhaust quote", tsSec: 725 }, row)).toBe(false);
  });
});

describe("matchItems", () => {
  const rows = [
    existing({ id: "r1", title: "Send October MIS to the owner" }),
    existing({ id: "r2", title: "Approve kitchen exhaust quote", evidence_ts_sec: 526, status: "done" }),
    existing({ id: "r3", title: "Share duty roster", evidence_ts_sec: 1031, edited_by: "person-1" }),
    existing({ id: "r4", title: "Old item nobody mentions", evidence_ts_sec: 60 }),
  ];

  it("reuses rows by key and by nearby evidence, supersedes the rest, keeps edited rows", () => {
    const out = matchItems([item("A1", "Send October MIS to the owner"), item("A2", "Approve the exhaust quote from vendor", "client", "8:46"), item("A3", "Brand new task")], rows, tsOf);
    expect(out.matches[0]).toMatchObject({ key: rows[0].item_key, existing: { id: "r1" } });
    expect(out.matches[1]).toMatchObject({ key: rows[1].item_key, existing: { id: "r2" } });
    expect(out.matches[2].existing).toBeNull();
    expect(out.supersededIds).toEqual(["r4"]);
    expect(out.keptIds).toEqual(["r3"]);
  });

  it("never gives two new items the same key or the same existing row", () => {
    const out = matchItems([item("A1", "Send October MIS to the owner"), item("A2", "Send October MIS to the owner!")], rows, tsOf);
    expect(out.matches[0].existing?.id).toBe("r1");
    expect(out.matches[1].existing).toBeNull();
    expect(out.matches[1].key).not.toBe(out.matches[0].key);
  });

  it("does not supersede rows already superseded or pushed to the ERP", () => {
    const out = matchItems([], [existing({ id: "s", title: "x", status: "superseded" }), existing({ id: "e", title: "y", erp_task_id: "ERP-1" })], tsOf);
    expect(out.supersededIds).toEqual([]);
    expect(out.keptIds).toEqual(["e"]);
  });
});

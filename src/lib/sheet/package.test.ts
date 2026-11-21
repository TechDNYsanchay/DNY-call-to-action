import { describe, expect, it, vi } from "vitest";
import exampleCallSheet from "../../../agent/example-call-sheet.json";
import exampleSheet from "../../../agent/example-sheet.json";
import context from "./fixtures/meeting-context.json";
// Captured once from the code before phone calls were added (a fake database holding meeting-context.json).
import todayPackage from "./fixtures/meeting-package.json";
import todaySchemas from "./fixtures/meeting-json-schemas.json";
import type { MeetingContext, MeetingRow } from "./load";
import { buildPackage, packageOf } from "./package";
import { callClassificationJsonSchema, sheetJsonSchema } from "./schema";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", async () => {
  const tables = (await import("./fixtures/meeting-context.json")).default;
  const { fakeDb } = await import("@/test/fake-db");
  const db = fakeDb(tables as never);
  return { supabaseAdmin: () => db, supabaseServer: async () => db };
});

const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

describe("a meeting's package", () => {
  it("is what it was before calls, plus kind, call and the claim", async () => {
    const meeting = context.meetings[0];
    const pkg = await buildPackage(meeting.id);
    expect(pkg).not.toBeNull();
    const { resultFormat, classificationFormat, ...rest } = pkg!;
    expect(rest).toEqual({
      ...todayPackage,
      meeting: { ...todayPackage.meeting, kind: "meeting" },
      call: null,
      claim: meeting.claim_token,
    });
    expect(resultFormat).toEqual({ schema: todaySchemas.sheet, example: exampleSheet });
    expect(classificationFormat).toEqual({ schema: todaySchemas.classification });
  });
});

describe("a call's package", () => {
  const callId = "0d4f9b8e-1c2a-4e5f-8a7b-6c5d4e3f2a10";
  const token = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
  const row = {
    ...context.meetings[0],
    id: callId,
    kind: "call",
    tldv_meeting_id: null,
    callyzer_call_id: "f1e2d3c4b5a69788f1e2d3c4b5a69788f1e2d3c4b5a69788f1e2d3c4b5a697889",
    claim_token: token,
    title: null,
    happened_at: "2026-11-18T06:10:00+00:00",
    duration_sec: 252,
    organizer_email: "ashwini@dnyhospitality.com",
    organizer_name: "Ashwini Bhambani",
    tldv_url: null,
    meet_code: null,
    type: "unknown",
    type_source: null,
    type_confidence: null,
    type_reason: null,
    client_id: null,
    raw: { source: "callyzer" },
  } as unknown as MeetingRow;
  const ctx = (over: Partial<MeetingContext> = {}): MeetingContext => ({
    meeting: row,
    client: null,
    participants: [],
    turns: [
      { speaker: "Speaker 1", startSec: 0.8, endSec: 6.1, text: "Hello, haan Ashwini ji. Mera naya number 9820012345 hai." },
      { speaker: "Speaker 2", startSec: 7, endSec: 15.5, text: "Theek hai Rakesh ji, main menu costing Friday tak bhej dungi." },
    ],
    roster: [{ full_name: "Ashwini Bhambani", email: "ashwini@dnyhospitality.com", dept: "Account management" }],
    call: {
      direction: "outgoing",
      line: { id: "5c1f8a2e-6b7d-4e3f-9a10-2b3c4d5e6f70", name: "Ashwini 9820000001", people: [{ name: "Ashwini Bhambani", email: "ashwini@dnyhospitality.com", role: "Account management" }] },
      savedName: "Rakesh 98201 23456",
      previouslyBusiness: { type: "client", client: "Cafe 89" },
      speakers: 2,
      oneSided: false,
      knownClients: ["Cafe 89"],
      purgedAt: null,
    },
    ...over,
  });

  it("carries the call block, the claim and the call's formats, and no participants", () => {
    const pkg = packageOf(ctx(), 0.8);
    expect(pkg.meeting).toMatchObject({ id: callId, kind: "call", durationSec: 252, durationText: "4:12", tldvUrl: null, client: null });
    expect(pkg.claim).toBe(token);
    expect(pkg.participants).toEqual([]);
    expect(pkg.call).toMatchObject({ direction: "outgoing", counterpart: { savedName: "Rakesh", previousClient: "Cafe 89", previouslyBusiness: "client" } });
    expect(pkg.classification).toMatchObject({ decided: false, type: "unknown", threshold: 0.8 });
    expect(pkg.language.note).toContain("Speaker 1 and Speaker 2 are machine labels");
    expect(pkg.transcript[0]).toBe("[0:00] Speaker 1: Hello, haan Ashwini ji. Mera naya number 9820012345 hai.");
    expect(pkg.resultFormat).toEqual({ schema: sheetJsonSchema("call"), example: exampleCallSheet });
    expect(pkg.classificationFormat).toEqual({ schema: callClassificationJsonSchema() });
  });

  it("is decided once the call is a client or vendor call", () => {
    expect(packageOf(ctx({ meeting: { ...row, type: "vendor", type_source: "llm" } }), 0.8).classification.decided).toBe(true);
    expect(packageOf(ctx({ meeting: { ...row, type: "client", type_source: "human" } }), 0.8).classification.decided).toBe(true);
    expect(packageOf(ctx({ meeting: { ...row, type: "other", type_source: "llm" } }), 0.8).classification.decided).toBe(false);
  });

  it("has no run of 8 or more digits in the call block, the title or the participants", () => {
    const pkg = packageOf(ctx({ meeting: { ...row, title: "Call with Rakesh (Cafe 89)" } }), 0.8);
    const scanned = JSON.stringify({ call: pkg.call, title: pkg.meeting.title, participants: pkg.participants }).replace(UUIDS, "");
    expect(scanned).not.toMatch(/\d{8,}/);
    // The transcript itself is what was said, and may hold a number someone spoke.
    expect(pkg.transcript.join(" ")).toMatch(/\d{10}/);
  });
});

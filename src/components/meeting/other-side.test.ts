import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SheetView } from "@/lib/ui/sheet-result";
import { CountTriple } from "@/components/ui/chip";
import { Scoreboard } from "./scoreboard";
import { DecisionList, type EvidenceContext, QuestionList, RiskList } from "./sheet-sections";

// A vendor call's sheet names the other side "vendor" in the six places a meeting's sheet says "client";
// without the prop every string is exactly what meeting pages show today.

const evidence = [{ timestamp: "0:42", speaker: "Speaker 2", quote: "bill kal bhej dunga", quote_english: "I will send the bill tomorrow" }];
const view: SheetView = {
  headline: "Sharma Traders sends the revised bill tomorrow",
  executive_summary: ["The vendor sends the revised bill tomorrow."],
  meeting_purpose: null,
  decisions: [{ id: "D1", statement: "The old rate stays until March", decided_by: "client", evidence, confidence: 0.9 }],
  key_facts: [],
  risks: [{ id: "R1", description: "Deliveries may slip a week", severity: "medium", affects: "client", mitigation_discussed: null, evidence, confidence: 0.8 }],
  open_questions: [{ id: "Q1", question: "Can the order be split in two?", raised_by: "dny", needs_answer_from: "client", evidence, confidence: 0.8 }],
  next_meeting: null,
  client_sentiment: null,
  quality: null,
  overall_confidence: 0.85,
  verification: {},
  complete: false,
};
const meetingCtx: EvidenceContext = { tldvUrl: null, timestampParam: null };
const vendorCtx: EvidenceContext = { ...meetingCtx, otherSide: { word: "vendor", name: "Sharma Traders" } };
const html = (element: ReturnType<typeof createElement>) => renderToStaticMarkup(element);

describe("the other side of a call's sheet", () => {
  it("says vendor on a vendor call", () => {
    expect(html(createElement(Scoreboard, { dny: 1, client: 2, decisions: 1, risks: 1, otherSide: { word: "vendor" } }))).toContain("for vendor");
    expect(html(createElement(CountTriple, { dny: 1, client: 2, decisions: 1, otherSide: { word: "vendor" } }))).toContain('aria-label="1 for DNY, 2 for vendor, 1 decisions"');
    expect(html(createElement(DecisionList, { view, ctx: vendorCtx }))).toContain("by vendor");
    expect(html(createElement(RiskList, { view, ctx: vendorCtx }))).toContain("affects the vendor");
    expect(html(createElement(QuestionList, { view, ctx: vendorCtx }))).toContain("vendor to answer");
  });

  it("says client exactly as today without the prop", () => {
    const board = html(createElement(Scoreboard, { dny: 1, client: 2, decisions: 1, risks: 1 }));
    expect(board).toContain("for client");
    expect(board).not.toContain("vendor");
    expect(html(createElement(CountTriple, { dny: 1, client: 2, decisions: 1 }))).toContain('aria-label="1 for DNY, 2 for client, 1 decisions"');
    expect(html(createElement(DecisionList, { view, ctx: meetingCtx }))).toContain("by client");
    expect(html(createElement(RiskList, { view, ctx: meetingCtx }))).toContain("affects the client");
    expect(html(createElement(QuestionList, { view, ctx: meetingCtx }))).toContain("client to answer");
  });

  it("names the speaker and plays quotes only on a call page that can play", () => {
    const named = html(createElement(DecisionList, { view, ctx: { ...vendorCtx, speakerNames: { "Speaker 2": "Rakesh (vendor)" }, seekable: true, refined: { D1: [43.5] } } }));
    expect(named).toContain("Rakesh (vendor)");
    expect(named).toContain('data-seek="43.5"');
    expect(named).toContain('data-refined="1"');
    const meeting = html(createElement(DecisionList, { view, ctx: meetingCtx }));
    expect(meeting).not.toContain("data-seek");
    expect(meeting).toContain("Speaker 2");
  });
});

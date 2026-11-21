import { describe, expect, it } from "vitest";
import fullPage from "./fixtures/call-history-full-page.json";
import page from "./fixtures/call-history-page.json";
import { apiDateTimeToIso, type CallyzerRow, parseCallHistoryEnvelope, parseCallHistoryRow } from "./parse";

const rowOf = (raw: unknown): CallyzerRow => {
  const parsed = parseCallHistoryRow(raw);
  if (!("row" in parsed)) throw new Error(parsed.error);
  return parsed.row;
};

describe("apiDateTimeToIso", () => {
  it("reads the API's date and 12-hour time as India time", () => {
    expect(apiDateTimeToIso("19 Nov 2026", "02:06 PM")).toBe("2026-11-19T14:06:00+05:30");
    expect(apiDateTimeToIso("19 Nov 2026", "12:05 AM")).toBe("2026-11-19T00:05:00+05:30");
    expect(apiDateTimeToIso("19 Nov 2026", "12:30 pm")).toBe("2026-11-19T12:30:00+05:30");
    expect(apiDateTimeToIso("1 Dec 2026", "11:40:05 am")).toBe("2026-12-01T11:40:05+05:30");
  });
  it("refuses what is not a date and time", () => {
    expect(apiDateTimeToIso("31 Foo 2026", "02:06 PM")).toBeNull();
    expect(apiDateTimeToIso("31 Nov 2026", "02:06 PM")).toBeNull();
    expect(apiDateTimeToIso("19 Nov 2026", "25:00")).toBeNull();
    expect(apiDateTimeToIso("19/11/2026", "02:06 PM")).toBeNull();
  });
});

describe("parseCallHistoryEnvelope", () => {
  it("returns the rows and the total", () => {
    const { rows, recordsTotal } = parseCallHistoryEnvelope(page);
    expect(rows).toHaveLength(8);
    expect(recordsTotal).toBe(8);
  });
  it("defaults a missing data array to no rows and a missing total to null", () => {
    expect(parseCallHistoryEnvelope({ message: "No data" })).toEqual({ rows: [], recordsTotal: null });
    expect(parseCallHistoryEnvelope(null)).toEqual({ rows: [], recordsTotal: null });
    expect(parseCallHistoryEnvelope(fullPage).recordsTotal).toBeNull();
    expect(parseCallHistoryEnvelope(fullPage).rows).toHaveLength(100);
    expect(parseCallHistoryEnvelope({ data: [], recordsTotal: "230" }).recordsTotal).toBe(230);
  });
});

describe("parseCallHistoryRow", () => {
  const [first, , , support, waiting, , missed] = page.data;

  it("reads the verified fields of a call", () => {
    expect(rowOf(first)).toEqual({
      uniqueId: first.uniqueId.trim(),
      employeeName: "Ashwini Bhambani",
      employeeNumber: "9820000001",
      clientName: "Rakesh Cafe 89",
      countryCode: "91",
      clientNumber: "9820123456",
      startedAt: "2026-11-19T14:06:00+05:30",
      durationSec: 323,
      callType: "Incoming",
      recordingUrl: "https://media1.callyzer.co/recordings/2026/11/19/fixture-1.mp3",
    });
  });
  it("trims the id and turns a numeric employee number into a string", () => {
    const row = rowOf(first);
    expect(row.uniqueId).not.toMatch(/^\s|\s$/);
    expect(row.uniqueId).toHaveLength(65);
    expect(typeof row.employeeNumber).toBe("string");
  });
  it("keeps only https recording links", () => {
    expect(rowOf(waiting).recordingUrl).toBeNull();
    expect(rowOf(missed).recordingUrl).toBeNull();
    expect(rowOf({ ...first, callRecordingPath: "http://media1.callyzer.co/x.mp3" }).recordingUrl).toBeNull();
    expect(rowOf({ ...first, callRecordingPath: undefined }).recordingUrl).toBeNull();
    expect(rowOf({ ...first, callRecordingPath: "https://media1.callyzer.co/x.mp3" }).recordingUrl).toBe("https://media1.callyzer.co/x.mp3");
  });
  it("takes any phone number out of the line's name, and a name that is only a number is no name", () => {
    expect(rowOf({ ...first, employeeName: "keyur 9820000002" }).employeeName).toBe("keyur");
    expect(rowOf({ ...first, employeeName: "+91 98111 00010" }).employeeName).toBeNull();
    expect(rowOf({ ...first, employeeName: "9820000001" }).employeeName).toBeNull();
    expect(rowOf({ ...first, employeeName: "  " }).employeeName).toBeNull();
    expect(rowOf({ ...first, employeeName: null }).employeeName).toBeNull();
  });
  it("treats 'unknown', 'null' and empty contact names as no name", () => {
    expect(rowOf(support).clientName).toBeNull();
    expect(rowOf({ ...first, clientName: "null" }).clientName).toBeNull();
    expect(rowOf({ ...first, clientName: "  " }).clientName).toBeNull();
  });
  it("reports a row without an id, or with an unreadable time, as an error", () => {
    expect(parseCallHistoryRow({ ...first, uniqueId: undefined })).toEqual({ error: "unreadable call-history row" });
    expect(parseCallHistoryRow({ ...first, uniqueId: "  " })).toEqual({ error: "unreadable call-history row" });
    expect(parseCallHistoryRow({ ...first, time: "later" })).toEqual({ error: "unreadable call date or time", id: first.uniqueId.trim() });
    expect(parseCallHistoryRow("nonsense")).toEqual({ error: "unreadable call-history row" });
  });
  it("reads every row of a full page", () => {
    expect(fullPage.data.map(parseCallHistoryRow).every((r) => "row" in r)).toBe(true);
  });
});

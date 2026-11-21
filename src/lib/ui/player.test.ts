import { describe, expect, it } from "vitest";
import { activeIndex, canPlayState, collectTicks, deletedText, evidenceTicks, initialPlayerState, mergeTicks, type PlayerEvent, playerMessage, playerReducer, type PlayerState, readLinkReply, recordingLength, scrubberValueText, speakerOrder, speakerSpans } from "./player";

const T0 = Date.parse("2026-11-19T06:00:00Z");
const MIN = 60_000;
const run = (events: PlayerEvent[], from: PlayerState = initialPlayerState()) => events.reduce(playerReducer, from);

/** Stored, link fetched (an hour), metadata loaded. */
const loadedState = () => run([{ type: "availability", availability: "stored" }, { type: "link", url: "https://s/a?t=1", expiresAt: T0 + 60 * MIN }, { type: "loaded" }]);

describe("playerReducer", () => {
  it("fetches a link once the page says the recording is stored, then loads it", () => {
    const asked = playerReducer(initialPlayerState(), { type: "availability", availability: "stored" });
    expect(asked).toMatchObject({ status: "fetching", fetching: true, fetchSeq: 1, effects: [{ kind: "fetch" }] });
    const linked = playerReducer(asked, { type: "link", url: "https://s/a?t=1", expiresAt: T0 + 60 * MIN });
    expect(linked).toMatchObject({ status: "ready", url: "https://s/a?t=1", loaded: false, effects: [{ kind: "load", url: "https://s/a?t=1" }] });
    expect(canPlayState(linked)).toBe(true);
    // A page refresh that says "stored" again does not fetch again.
    expect(playerReducer(linked, { type: "availability", availability: "stored" }).effects).toEqual([]);
  });

  it("defers a link refreshed while playing to the pause, and restores the place", () => {
    const playing = run([{ type: "playing" }], loadedState());
    const refreshing = playerReducer(playing, { type: "tick", now: T0 + 51 * MIN });
    expect(refreshing.effects).toEqual([{ kind: "fetch" }]);
    const held = playerReducer(refreshing, { type: "link", url: "https://s/a?t=2", expiresAt: T0 + 111 * MIN });
    expect(held).toMatchObject({ status: "playing", url: "https://s/a?t=1", pendingUrl: { url: "https://s/a?t=2" }, effects: [] });
    // Nothing more to fetch while the fresh link waits.
    expect(playerReducer(held, { type: "tick", now: T0 + 55 * MIN }).effects).toEqual([]);
    const paused = playerReducer(held, { type: "paused", position: 42, ended: false });
    expect(paused).toMatchObject({ status: "ready", url: "https://s/a?t=2", pendingUrl: null, pendingSeek: 42, loaded: false, effects: [{ kind: "load", url: "https://s/a?t=2" }] });
    expect(playerReducer(paused, { type: "loaded" })).toMatchObject({ loaded: true, lastPosition: 42, pendingSeek: null, effects: [{ kind: "seek", at: 42 }] });
  });

  it("applies a link at the end from the start", () => {
    const held = run([{ type: "playing" }, { type: "tick", now: T0 + 55 * MIN }, { type: "link", url: "https://s/a?t=2", expiresAt: T0 + 115 * MIN }], loadedState());
    expect(playerReducer(held, { type: "paused", position: 251, ended: true })).toMatchObject({ url: "https://s/a?t=2", pendingSeek: null, lastPosition: 0 });
  });

  it("refetches on visible when less than 10 minutes remain, and not before", () => {
    const paused = run([{ type: "seek", position: 30 }], loadedState());
    expect(playerReducer(paused, { type: "visible", now: T0 + 40 * MIN }).effects).toEqual([]);
    const asked = playerReducer(paused, { type: "visible", now: T0 + 70 * MIN });
    expect(asked.effects).toEqual([{ kind: "fetch" }]);
    // Paused: the new link is applied at once and the place kept, so one tap plays.
    const linked = playerReducer(asked, { type: "link", url: "https://s/a?t=3", expiresAt: T0 + 130 * MIN });
    expect(linked).toMatchObject({ url: "https://s/a?t=3", pendingSeek: 30, effects: [{ kind: "load", url: "https://s/a?t=3" }] });
  });

  it("holds a seek made before the metadata and applies it when it loads", () => {
    const linked = run([{ type: "availability", availability: "stored" }, { type: "link", url: "https://s/a", expiresAt: T0 + 60 * MIN }]);
    const sought = playerReducer(linked, { type: "seek", position: 82 });
    expect(sought).toMatchObject({ pendingSeek: 82, effects: [] });
    expect(playerReducer(sought, { type: "loaded" })).toMatchObject({ lastPosition: 82, effects: [{ kind: "seek", at: 82 }] });
    // Once loaded a seek applies at once.
    expect(playerReducer(loadedState(), { type: "seek", position: -5 }).effects).toEqual([{ kind: "seek", at: 0 }]);
  });

  it("refetches after a media error, restores the place and resumes when it was playing", () => {
    const failed = playerReducer(run([{ type: "playing" }], loadedState()), { type: "media_error", position: 100, wasPlaying: true });
    expect(failed).toMatchObject({ status: "fetching", url: null, pendingSeek: 100, resume: true, effects: [{ kind: "fetch" }] });
    const reloaded = run([{ type: "link", url: "https://s/a?t=9", expiresAt: T0 + 120 * MIN }, { type: "loaded" }], failed);
    expect(reloaded.effects).toEqual([{ kind: "seek", at: 100 }, { kind: "play" }]);
    // The browser refused to resume without a tap.
    expect(playerReducer(reloaded, { type: "blocked" })).toMatchObject({ blocked: true });
  });

  it("uses a fresher link at once after a media error, and gives up after repeated errors", () => {
    const held = run([{ type: "playing" }, { type: "tick", now: T0 + 55 * MIN }, { type: "link", url: "https://s/a?t=2", expiresAt: T0 + 115 * MIN }], loadedState());
    expect(playerReducer(held, { type: "media_error", position: 10, wasPlaying: true })).toMatchObject({ status: "ready", url: "https://s/a?t=2", effects: [{ kind: "load", url: "https://s/a?t=2" }] });
    let s = loadedState();
    for (let i = 0; i < 3; i++) s = run([{ type: "media_error", position: 5, wasPlaying: false }, { type: "link", url: `https://s/a?e=${i}`, expiresAt: T0 + 60 * MIN }, { type: "loaded" }], s);
    expect(s.status).toBe("error");
    expect(playerMessage(s)).toBe("The recording could not be loaded.");
    expect(playerReducer(s, { type: "retry" }).effects).toEqual([{ kind: "fetch" }]);
  });

  it("treats a 401, a redirect or HTML as signed out", () => {
    const asked = run([{ type: "availability", availability: "stored" }]);
    for (const reply of [
      { status: 401, redirected: false, contentType: "application/json", body: { error: "signed_out" } },
      { status: 200, redirected: true, contentType: "text/html", body: null },
      { status: 200, redirected: false, contentType: "text/html; charset=utf-8", body: null },
    ]) {
      const result = readLinkReply(reply);
      expect(result).toEqual({ ok: false, failure: { kind: "signed_out" } });
      if (result.ok) continue;
      const out = playerReducer(asked, { type: "link_failed", failure: result.failure, now: T0 });
      expect(out).toMatchObject({ status: "unavailable", reason: "signed_out", effects: [{ kind: "clear" }] });
      expect(playerMessage(out)).toBe("You were signed out. Reload the page.");
    }
  });

  it("reads denials, server errors and good replies", () => {
    expect(readLinkReply({ status: 409, redirected: false, contentType: "application/json", body: { reason: "not_work" } })).toEqual({ ok: false, failure: { kind: "denied", reason: "not_work" } });
    expect(readLinkReply({ status: 403, redirected: false, contentType: "application/json", body: {} })).toEqual({ ok: false, failure: { kind: "denied", reason: "not_classified" } });
    expect(readLinkReply({ status: 502, redirected: false, contentType: "text/html", body: null })).toEqual({ ok: false, failure: { kind: "network" } });
    expect(readLinkReply({ status: 200, redirected: false, contentType: "application/json", body: { url: "https://x/y", expiresAt: "2026-11-19T07:00:00.000Z", mime: "audio/mpeg", playable: true } })).toEqual({ ok: true, url: "https://x/y", expiresAt: Date.parse("2026-11-19T07:00:00.000Z"), mime: "audio/mpeg", playable: true });
  });

  it("keeps playing a working link when a refresh fails, and stops when the call is gone", () => {
    const playing = run([{ type: "playing" }, { type: "tick", now: T0 + 55 * MIN }], loadedState());
    expect(playerReducer(playing, { type: "link_failed", failure: { kind: "network" }, now: T0 + 55 * MIN })).toMatchObject({ status: "playing", url: "https://s/a?t=1", failedAt: T0 + 55 * MIN });
    expect(playerReducer(playing, { type: "link_failed", failure: { kind: "denied", reason: "not_work" }, now: T0 })).toMatchObject({ status: "unavailable", reason: "not_work", url: null, effects: [{ kind: "clear" }] });
    // A failed refresh is not retried within a minute.
    const failed = playerReducer(playing, { type: "link_failed", failure: { kind: "network" }, now: T0 + 55 * MIN });
    expect(playerReducer(failed, { type: "tick", now: T0 + 55.5 * MIN }).effects).toEqual([]);
    expect(playerReducer(failed, { type: "tick", now: T0 + 56.5 * MIN }).effects).toEqual([{ kind: "fetch" }]);
  });

  it("pauses and clears when the call is no longer playable, and drops a late link", () => {
    const playing = run([{ type: "playing" }], loadedState());
    const gone = playerReducer(playing, { type: "availability", availability: "not_work" });
    expect(gone).toMatchObject({ status: "unavailable", reason: "not_work", url: null, effects: [{ kind: "clear" }] });
    expect(canPlayState(gone)).toBe(false);
    expect(playerMessage(gone)).toBe("Deleted: not a work call");
    expect(playerMessage(playerReducer(playing, { type: "availability", availability: "deleted" }))).toBe("Recording deleted after 30 days");
    expect(playerMessage(playerReducer(playing, { type: "availability", availability: "withheld" }))).toBeNull();
    const late = playerReducer(gone, { type: "link", url: "https://s/late", expiresAt: T0 + 60 * MIN });
    expect(late.url).toBeNull();
    // Confirmed as business later: the player fetches.
    expect(playerReducer(gone, { type: "availability", availability: "stored" }).effects).toEqual([{ kind: "fetch" }]);
  });

  it("names why a deleted call's recording is gone, from its skip code", () => {
    expect(deletedText("no_speech")).toBe("Deleted: no speech in the recording");
    expect(deletedText("undecided")).toBe("Deleted: not confirmed as a work call in time");
    expect(deletedText("line_off")).toBe("Deleted: the line was switched off");
    for (const code of ["personal", "internal", "sales", "wrong_number", "no_content", "not_business", null, undefined]) expect(deletedText(code)).toBe("Deleted: not a work call");
    const playing = run([{ type: "playing" }], loadedState());
    const silent = playerReducer(playing, { type: "availability", availability: "not_work", skipCode: "no_speech" });
    expect(silent).toMatchObject({ status: "unavailable", reason: "not_work", skipCode: "no_speech", effects: [{ kind: "clear" }] });
    expect(playerMessage(silent)).toBe("Deleted: no speech in the recording");
    expect(playerMessage(playerReducer(playing, { type: "availability", availability: "not_work", skipCode: "undecided" }))).toBe("Deleted: not confirmed as a work call in time");
    expect(playerMessage(playerReducer(playing, { type: "availability", availability: "not_work", skipCode: "line_off" }))).toBe("Deleted: the line was switched off");
    // A link refused before the page has said why (deleted in another tab): the general words until it does.
    const refreshing = run([{ type: "tick", now: T0 + 55 * MIN }], playing);
    const refused = playerReducer(refreshing, { type: "link_failed", failure: { kind: "denied", reason: "not_work" }, now: T0 + 55 * MIN });
    expect(playerMessage(refused)).toBe("Deleted: not a work call");
    expect(playerMessage(playerReducer(refused, { type: "availability", availability: "not_work", skipCode: "line_off" }))).toBe("Deleted: the line was switched off");
    // A recording that is stored again carries no skip code.
    expect(playerReducer(silent, { type: "availability", availability: "stored" }).skipCode).toBeNull();
  });

  it("asks to play before the link arrives and plays once it loads", () => {
    const asked = run([{ type: "availability", availability: "stored" }, { type: "want_play" }, { type: "seek", position: 12 }]);
    const loaded = run([{ type: "link", url: "https://s/a", expiresAt: T0 + 60 * MIN }, { type: "loaded" }], asked);
    expect(loaded.effects).toEqual([{ kind: "seek", at: 12 }, { kind: "play" }]);
    expect(playerReducer(loaded, { type: "playing" })).toMatchObject({ status: "playing", resume: false });
  });
});

describe("timing maths", () => {
  const turns = [
    { speaker: "Speaker 2", startSec: 0, endSec: 4, text: "a" },
    { speaker: "Speaker 2", startSec: 4.5, endSec: 9, text: "b" },
    { speaker: "Speaker 1", startSec: 9.2, endSec: 15, text: "c" },
    { speaker: "Speaker 2", startSec: 15.4, endSec: 20, text: "d" },
  ];

  it("merges adjacent turns of one speaker, indexed by first speech", () => {
    expect(speakerSpans(turns)).toEqual([
      [0, 9, 0],
      [9.2, 15, 1],
      [15.4, 20, 0],
    ]);
    expect(speakerOrder(turns)).toEqual(["Speaker 2", "Speaker 1"]);
    expect(speakerSpans([])).toEqual([]);
  });

  it("finds the active line at the edges", () => {
    const starts = turns.map((t) => t.startSec);
    expect(activeIndex(starts, -1)).toBe(-1);
    expect(activeIndex(starts, 0)).toBe(0);
    expect(activeIndex(starts, 4.49)).toBe(0);
    expect(activeIndex(starts, 4.5)).toBe(1);
    expect(activeIndex(starts, 999)).toBe(3);
    expect(activeIndex([], 3)).toBe(-1);
  });

  it("takes the longest length and says the place in words", () => {
    expect(recordingLength(240, 251.4, turns)).toBe(251.4);
    expect(recordingLength(10, null, turns)).toBe(20);
    expect(scrubberValueText(83, 252)).toBe("1 minute 23 seconds of 4 minutes 12 seconds");
  });
});

describe("evidence ticks", () => {
  const view = {
    decisions: [{ id: "D1", statement: "Menu costing goes to the owner", decided_by: "joint" as const, evidence: [{ timestamp: "0:10", speaker: "Speaker 1", quote: "costing bhej do", quote_english: null }], confidence: 0.9 }],
    key_facts: [{ id: "F1", fact: "Food cost is 34%", category: "metric" as const, normalized_value: "34%", evidence: [{ timestamp: "1:00", speaker: "Speaker 2", quote: "34 percent", quote_english: null }], confidence: 0.9 }],
    risks: [{ id: "R1", description: "Vendor bills are late", severity: "medium" as const, affects: "dny" as const, mitigation_discussed: null, evidence: [{ timestamp: "2:00", speaker: "Speaker 2", quote: "bills late", quote_english: null }], confidence: 0.8 }],
    open_questions: [],
  };
  const items = [
    { id: "a1", title: "Send the revised costing", owed_by: "dny" as const, status: "open" as const, evidence_ts_sec: 12, evidence_quote: "main bhej deti hoon" },
    { id: "a2", title: "Share vendor bills", owed_by: "client" as const, status: "open" as const, evidence_ts_sec: 150, evidence_quote: "bills share karo" },
    { id: "a3", title: "Dropped", owed_by: "dny" as const, status: "dropped" as const, evidence_ts_sec: 40, evidence_quote: null },
  ];

  it("colours by lane and prefers the refined second", () => {
    const ticks = collectTicks(view, items, { F1: [64.5] });
    expect(ticks.map((t) => [t.id, t.sec, t.tone, t.refined])).toEqual([
      ["D1", 10, "decision", false],
      ["a1", 12, "dny", false],
      ["F1", 64.5, "info", true],
      ["R1", 120, "risk", false],
      ["a2", 150, "other", false],
    ]);
  });

  it("merges ticks closer than 24 px into one marker", () => {
    // 300 s on 600 px: 2 px a second.
    const groups = evidenceTicks(view, items, 600, 300);
    expect(groups.map((g) => [g.sec, g.ticks.length, g.tone])).toEqual([
      [10, 2, "mixed"],
      [60, 1, "info"],
      [120, 1, "risk"],
      [150, 1, "other"],
    ]);
    expect(groups[0].x).toBeCloseTo(22);
    expect(mergeTicks(collectTicks(view, items), 0, 300)).toEqual([]);
  });
});

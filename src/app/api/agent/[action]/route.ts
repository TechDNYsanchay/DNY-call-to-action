// The Claude Code routine's work API. Bearer AGENT_TOKEN on every call; the routine never holds a
// database key. GET next claims a meeting and returns the whole package; POST classify/save/skip/
// release report the result. Every failure is JSON with an "error" and, where useful, "errors".

import { readFile } from "node:fs/promises";
import path from "node:path";
import { applyClassification } from "@/lib/sheet/classify";
import { buildPackage, claimNext } from "@/lib/sheet/package";
import { releaseMeeting, skipMeeting } from "@/lib/sheet/release";
import { saveSheet } from "@/lib/sheet/save";
import { readAgentSettings } from "@/lib/sheet/settings";
import { presentedBearer, secretMatches } from "@/lib/webhooks";

export const maxDuration = 60;

type Context = { params: Promise<{ action: string }> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const json = (body: unknown, status = 200) => Response.json(body, { status });

function authorise(request: Request): Response | null {
  const expected = process.env.AGENT_TOKEN;
  if (!expected) return json({ error: "AGENT_TOKEN is not configured on the server" }, 503);
  if (!secretMatches(presentedBearer(request), expected)) {
    console.warn(`agent api ${new URL(request.url).pathname}: refused, wrong or missing token`);
    return json({ error: "Unauthorised: send Authorization: Bearer <AGENT_TOKEN>" }, 401);
  }
  return null;
}

function meetingIdFrom(url: URL): { id: string } | { error: Response } {
  const id = url.searchParams.get("meetingId")?.trim() ?? "";
  if (!UUID.test(id)) return { error: json({ error: "meetingId must be the meeting's uuid from the package" }, 400) };
  return { id: id.toLowerCase() };
}

export async function GET(request: Request, { params }: Context) {
  const refused = authorise(request);
  if (refused) return refused;
  const { action } = await params;
  const url = new URL(request.url);
  try {
    switch (action) {
      case "guide": {
        const text = await readFile(path.join(process.cwd(), "agent", "guide.md"), "utf8");
        return new Response(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
      }
      case "next": {
        const settings = await readAgentSettings();
        if (settings.pipelinePaused) return json({ done: true, reason: "The pipeline is paused in settings" });
        const exclude = (url.searchParams.get("exclude") ?? "")
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter((s) => UUID.test(s));
        const id = await claimNext(exclude);
        if (!id) return json({ done: true });
        const pkg = await buildPackage(id);
        if (!pkg) return json({ error: `Claimed meeting ${id} but could not load it` }, 500);
        return json({ done: false, ...pkg });
      }
      default:
        return json({ error: `Unknown action "${action}". GET: guide, next. POST: classify, save, skip, release.` }, 404);
    }
  } catch (error) {
    console.error(`agent api GET ${action}:`, error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
}

export async function POST(request: Request, { params }: Context) {
  const refused = authorise(request);
  if (refused) return refused;
  const { action } = await params;
  const url = new URL(request.url);
  const meeting = meetingIdFrom(url);
  if ("error" in meeting) return meeting.error;
  try {
    switch (action) {
      case "classify": {
        const body = await readJson(request);
        if ("error" in body) return body.error;
        const outcome = await applyClassification(meeting.id, body.value);
        return json(outcome, outcome.ok ? 200 : 422);
      }
      case "save": {
        const body = await readJson(request);
        if ("error" in body) return body.error;
        const dryRun = url.searchParams.get("dryRun") === "1" || url.searchParams.get("dryRun") === "true";
        const outcome = await saveSheet(meeting.id, body.value, { dryRun });
        return json({ ...outcome, dryRun }, outcome.ok ? 200 : 422);
      }
      case "skip": {
        const type = url.searchParams.get("type");
        if (type !== "sales" && type !== "internal" && type !== "other") return json({ error: "type must be sales, internal or other" }, 400);
        const reason = (url.searchParams.get("reason") ?? "").trim();
        if (!reason) return json({ error: "reason is required: one sentence on why this is not a client meeting" }, 400);
        const outcome = await skipMeeting(meeting.id, type, reason.slice(0, 500));
        return json(outcome, outcome.ok ? 200 : 422);
      }
      case "release": {
        const reason = (url.searchParams.get("reason") ?? "").trim() || "No reason given";
        const outcome = await releaseMeeting(meeting.id, reason);
        return json(outcome, outcome.ok ? 200 : 422);
      }
      default:
        return json({ error: `Unknown action "${action}". POST: classify, save, skip, release. GET: guide, next.` }, 404);
    }
  } catch (error) {
    console.error(`agent api POST ${action}:`, error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
}

async function readJson(request: Request): Promise<{ value: unknown } | { error: Response }> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > 4_000_000) return { error: json({ error: "Body too large (4 MB limit)" }, 413) };
  const text = await request.text();
  if (!text.trim()) return { error: json({ error: "Body must be the JSON document" }, 400) };
  try {
    return { value: JSON.parse(text) };
  } catch {
    return { error: json({ error: "Body is not valid JSON" }, 400) };
  }
}

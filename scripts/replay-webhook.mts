// Posts a tl;dv webhook event to the local app, the way tl;dv would. Webhooks never reach a laptop,
// so this is how ingestion is exercised locally (the dev server must be running on port 3200).
//
// Usage (npm run replay loads .env.local, which must hold TLDV_WEBHOOK_SECRET):
//   npm run replay -- meeting-ready                 posts src/lib/tldv/fixtures/webhook-meeting-ready.json
//   npm run replay -- transcript-ready              posts src/lib/tldv/fixtures/webhook-transcript-ready.json
//   npm run replay -- path/to/saved-event.json      posts a payload saved from tl;dv
//   npm run replay -- meeting-ready --url https://<host>/api/webhooks/tldv
//   npm run replay -- meeting-ready --fresh         rewrites id and executedAt so dedupe and the 24 h check pass
//
// The fixture meeting id does not exist in tl;dv, so with a real API key the app answers
// "status: not_found" for fixtures; use --fresh with a saved real event to test end to end.

import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const fixtures = path.join(here, "..", "src", "lib", "tldv", "fixtures");
const aliases: Record<string, string> = {
  "meeting-ready": path.join(fixtures, "webhook-meeting-ready.json"),
  "transcript-ready": path.join(fixtures, "webhook-transcript-ready.json"),
};

function parseArgs(argv: string[]): { file: string; url: string; fresh: boolean } {
  let url = process.env.REPLAY_URL ?? "http://localhost:3200/api/webhooks/tldv";
  let fresh = false;
  let file: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--url") url = argv[++i] ?? url;
    else if (arg === "--fresh") fresh = true;
    else if (!file) file = aliases[arg] ?? arg;
  }
  if (!file) {
    console.error("Usage: npm run replay -- <meeting-ready | transcript-ready | file.json> [--url <endpoint>] [--fresh]");
    process.exit(2);
  }
  return { file, url, fresh };
}

async function main() {
  const { file, url, fresh } = parseArgs(process.argv.slice(2));
  const secret = process.env.TLDV_WEBHOOK_SECRET;
  if (!secret) {
    console.error("TLDV_WEBHOOK_SECRET is not set (run through `npm run replay`, which loads .env.local)");
    process.exit(2);
  }
  const payload = JSON.parse(await readFile(file, "utf8")) as Record<string, unknown>;
  if (fresh) {
    payload.id = `replay_${Date.now().toString(36)}`;
    payload.executedAt = new Date().toISOString();
  }
  const startedAt = Date.now();
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-webhook-secret": secret },
    body: JSON.stringify(payload),
  });
  const text = await response.text();
  console.log(`${response.status} ${response.statusText} in ${Date.now() - startedAt} ms`);
  console.log(text);
  if (!response.ok) process.exit(1);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Where the two most sensitive columns may appear in the source. recording_url holds Callyzer's links, which
// are bearer URLs that never expire; counterpart_e164 holds the other party's full number. Both live only
// in call_log (secret key only). New code that reads them belongs in one of the allowed places, or the
// boundary needs a deliberate change here.

const ROOT = path.resolve(__dirname, "../../..");
const SCANNED = ["src", "supabase", "scripts", "agent"];
const EXTENSIONS = /\.(ts|tsx|mts|js|mjs|sql|md|sh)$/;

function files(dir: string): string[] {
  let out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out = out.concat(files(full));
    else if (EXTENSIONS.test(name)) out.push(full);
  }
  return out;
}

const tree = SCANNED.flatMap((dir) => files(path.join(ROOT, dir))).map((file) => ({ rel: path.relative(ROOT, file).split(path.sep).join("/"), text: readFileSync(file, "utf8") }));
const using = (column: string) => tree.filter((f) => f.text.includes(column)).map((f) => f.rel);
const THIS_FILE = "src/lib/calls/secrets-boundary.test.ts";

const SECRET_STORES = (rel: string) =>
  rel.startsWith("src/lib/calls/") ||
  rel === "src/lib/supabase/database.types.ts" ||
  /^supabase\/migrations\/\d+_callyzer_calls\.sql$/.test(rel) ||
  rel === "supabase/tests/calls_test.sql";

describe("the secrets boundary", () => {
  it("scans the source tree", () => {
    expect(tree.length).toBeGreaterThan(100);
    expect(tree.some((f) => f.rel === "src/lib/calls/rules.ts")).toBe(true);
  });
  it("keeps recording_url in the calls pipeline, the generated types, the migration and its SQL tests", () => {
    const outside = using("recording_url").filter((rel) => !SECRET_STORES(rel));
    expect(outside).toEqual([]);
  });
  it("keeps counterpart_e164 there too, plus the calls data module and the database's own lookup of earlier calls", () => {
    // The routine's package and holds ask previous_business_call (F25) by the call's id, so no request to
    // the database carries the number: src/lib/sheet/ never reads it. The Calls search by number sends its
    // digits in the body of call_ids_by_digits (F26), which matches them inside the database.
    const allowed = (rel: string) =>
      SECRET_STORES(rel) ||
      rel === "src/lib/data/calls.ts" ||
      /^supabase\/migrations\/\d+_routine_call_writes\.sql$/.test(rel) ||
      rel === "supabase/tests/calls_agent_test.sql" ||
      /^supabase\/migrations\/\d+_call_number_search\.sql$/.test(rel) ||
      rel === "supabase/tests/calls_search_test.sql";
    expect(using("counterpart_e164").filter((rel) => !allowed(rel))).toEqual([]);
  });
  it("never selects every column of the secret-only tables", () => {
    const wildcard = /from\(\s*["'](call_log|call_transcripts)["']\s*\)\s*\.select\(\s*["']\*["']/;
    const offenders = tree.filter((f) => f.rel !== THIS_FILE && wildcard.test(f.text.replace(/\s+/g, " "))).map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});

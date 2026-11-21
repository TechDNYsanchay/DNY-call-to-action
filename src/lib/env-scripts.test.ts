import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// scripts/copy-shared-keys.sh and scripts/push-env.sh, run for real in a temp directory with fake values
// and a stub Vercel CLI that records its arguments and its stdin. HOME points at the temp directory and
// ENV_LOCAL at a temp file, so no test can ever reach a real .env.local.

const REPO = path.resolve(__dirname, "../..");
const COPY = path.join(REPO, "scripts/copy-shared-keys.sh");
const PUSH = path.join(REPO, "scripts/push-env.sh");

const BASE = "https://sandbox.api.callyzer.co";
const CZ_KEY = "cz-fake-key-0123456789abcdef";
const DG_KEY = "dg-fake-key-fedcba9876543210";

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_DIR/argv.log"
case "$1 $2" in
  "whoami "*) printf '%s\\n' "\${STUB_WHOAMI-tech-5297}" ;;
  "env rm") if [ -n "\${STUB_RM_NOT_FOUND-}" ]; then echo "Error: Environment Variable was not found" >&2; exit 1; fi ;;
  "env add")
    cat >> "$STUB_DIR/stdin.log"
    printf '\\n' >> "$STUB_DIR/stdin.log"
    if [ -n "\${STUB_REJECT_SENSITIVE-}" ]; then echo "Error: unknown or unexpected option: --sensitive" >&2; exit 1; fi
    if [ -n "\${STUB_ADD_FAILS-}" ]; then echo "Error: request failed (503)" >&2; exit 1; fi ;;
esac
`;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "env-scripts-"));
  writeFileSync(path.join(dir, "vc-stub.sh"), STUB);
  chmodSync(path.join(dir, "vc-stub.sh"), 0o755);
  writeFileSync(path.join(dir, "project.json"), '{"projectId":"prj_test","orgId":"team_OlIlw1Oi3U81fSrgeQnvcZaq","projectName":"dny-call-to-action"}');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const file = (name: string) => path.join(dir, name);
const read = (name: string) => (existsSync(file(name)) ? readFileSync(file(name), "utf8") : "");

function run(script: string, args: string[], env: Record<string, string> = {}) {
  const result = spawnSync("bash", [script, ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: "test",
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      HOME: dir,
      STUB_DIR: dir,
      ENV_LOCAL: file("dest.env"),
      VC_CMD: `bash ${file("vc-stub.sh")}`,
      PROJECT_JSON: file("project.json"),
      ...env,
    },
  });
  return { status: result.status, out: `${result.stdout}${result.stderr}`, stdout: result.stdout, stderr: result.stderr };
}

describe("scripts/push-env.sh", () => {
  const push = (names: string[], env: Record<string, string> = {}) => run(PUSH, names, env);
  beforeEach(() => writeFileSync(file("dest.env"), `OTHER=1\nCALLYZER_API_BASE=${BASE}\nCALLYZER_API_KEY="${CZ_KEY}"\r\nDEEPGRAM_API_KEY='${DG_KEY}'\nEMPTY_ONE=\n`));

  it("refuses when the Vercel CLI is not logged in as tech-5297, before any env command", () => {
    const r = push(["DEEPGRAM_API_KEY"], { STUB_WHOAMI: "tariquescript-9943" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("not logged in as tech-5297");
    expect(read("argv.log").trim()).toBe("whoami");
  });
  it("refuses when the project pin is not the DNY team's dny-call-to-action", () => {
    writeFileSync(file("other.json"), '{"projectId":"prj_x","orgId":"team_someoneElse","projectName":"dny-call-to-action"}');
    const r = push(["DEEPGRAM_API_KEY"], { PROJECT_JSON: file("other.json") });
    expect(r.status).not.toBe(0);
    expect(read("argv.log")).not.toMatch(/^env /m);
    const missing = push(["DEEPGRAM_API_KEY"], { PROJECT_JSON: file("nowhere.json") });
    expect(missing.status).not.toBe(0);
    expect(read("argv.log")).not.toMatch(/^env /m);
  });
  it("refuses any name but the three shared keys", () => {
    for (const names of [["SUPABASE_SECRET_KEY"], ["DEEPGRAM_API_KEY", "AGENT_TOKEN"], []]) {
      const r = push(names);
      expect(r.status).not.toBe(0);
    }
    expect(read("argv.log")).not.toMatch(/^env /m);
  });
  it("refuses a missing or empty value and pushes nothing at all", () => {
    writeFileSync(file("dest.env"), `CALLYZER_API_BASE=${BASE}\nCALLYZER_API_KEY=\n`);
    const r = push(["CALLYZER_API_BASE", "CALLYZER_API_KEY"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("CALLYZER_API_KEY is missing or empty in .env.local; nothing was pushed");
    expect(read("argv.log")).not.toMatch(/^env /m);
  });
  it("sends each value on stdin only, never as an argument, and never prints it", () => {
    const r = push(["CALLYZER_API_BASE", "CALLYZER_API_KEY", "DEEPGRAM_API_KEY"]);
    expect(r.status).toBe(0);
    expect(read("stdin.log").split("\n").filter(Boolean)).toEqual([BASE, CZ_KEY, DG_KEY]);
    const argv = read("argv.log");
    for (const value of [BASE, CZ_KEY, DG_KEY]) {
      expect(argv).not.toContain(value);
      expect(r.out).not.toContain(value);
    }
    expect(argv).toContain("env rm DEEPGRAM_API_KEY production --yes");
    expect(argv).toContain("env add DEEPGRAM_API_KEY production --sensitive");
    expect(r.stdout).toContain(`DEEPGRAM_API_KEY sent to Production (sensitive, ${DG_KEY.length} characters)`);
    expect(r.stdout).toContain(`CALLYZER_API_KEY sent to Production (sensitive, ${CZ_KEY.length} characters)`);
    expect(r.stdout).toContain("Redeploy for the values to apply.");
  });
  it("stops and says so when the CLI refuses --sensitive", () => {
    const r = push(["DEEPGRAM_API_KEY", "CALLYZER_API_KEY"], { STUB_REJECT_SENSITIVE: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Mark DEEPGRAM_API_KEY Sensitive in the Vercel dashboard");
    expect(r.stderr).toContain("DEEPGRAM_API_KEY was removed from Production and not re-added");
    expect(read("argv.log")).not.toContain("env add CALLYZER_API_KEY");
    expect(r.out).not.toContain(DG_KEY);
  });
  it("says a key it removed was not re-added when the add fails, and stops", () => {
    const r = push(["DEEPGRAM_API_KEY", "CALLYZER_API_KEY"], { STUB_ADD_FAILS: "1" });
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Adding DEEPGRAM_API_KEY to Production failed: DEEPGRAM_API_KEY was removed from Production and not re-added; fix the cause and re-run.");
    expect(r.stdout).not.toContain("sent to Production");
    expect(read("argv.log")).toContain("env rm DEEPGRAM_API_KEY production --yes");
    expect(read("argv.log")).not.toContain("CALLYZER_API_KEY");
    expect(r.out).not.toContain(DG_KEY);
    // A first push: nothing was there to remove, so nothing was lost.
    const first = push(["DEEPGRAM_API_KEY"], { STUB_ADD_FAILS: "1", STUB_RM_NOT_FOUND: "1" });
    expect(first.status).not.toBe(0);
    expect(first.stderr).toContain("Adding DEEPGRAM_API_KEY to Production failed: DEEPGRAM_API_KEY was not added to Production; fix the cause and re-run.");
    expect(first.stderr).not.toContain("removed");
  });
});

describe("scripts/copy-shared-keys.sh", () => {
  const copy = (source: string, env: Record<string, string> = {}) => run(COPY, [source], env);
  const source = (text: string) => {
    writeFileSync(file("sales-qa.env"), text);
    return file("sales-qa.env");
  };

  it("copies exactly the three names, keeps every other line, and leaves the file private", () => {
    writeFileSync(file("dest.env"), `KEEP=1\nDEEPGRAM_API_KEY=old-value\n# a comment\n`);
    const r = copy(source(`CALLYZER_API_BASE=${BASE}\nCALLYZER_API_KEY=${CZ_KEY}\nDEEPGRAM_API_KEY="${DG_KEY}"\nSUPABASE_SECRET_KEY=sales-qa-only\n`));
    expect(r.status).toBe(0);
    const dest = read("dest.env");
    expect(dest).toContain("KEEP=1\n");
    expect(dest).toContain("# a comment\n");
    expect(dest).toContain(`CALLYZER_API_BASE=${BASE}\n`);
    expect(dest).toContain(`CALLYZER_API_KEY=${CZ_KEY}\n`);
    expect(dest).toContain(`DEEPGRAM_API_KEY=${DG_KEY}\n`);
    expect(dest).not.toContain("old-value");
    expect(dest).not.toContain("SUPABASE_SECRET_KEY");
    expect(statSync(file("dest.env")).mode & 0o777).toBe(0o600);
    for (const value of [CZ_KEY, DG_KEY]) expect(r.out).not.toContain(value);
    expect(r.stdout).toContain(`CALLYZER_API_KEY saved (${CZ_KEY.length} characters)`);
    expect(r.stdout).toContain("CALLYZER_API_BASE host: sandbox.api.callyzer.co (allowed)");
  });
  it("refuses to copy this app's own file onto itself", () => {
    writeFileSync(file("dest.env"), `DEEPGRAM_API_KEY=${DG_KEY}\n`);
    const r = copy(file("dest.env"));
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("this app's own .env.local");
    expect(read("dest.env")).toBe(`DEEPGRAM_API_KEY=${DG_KEY}\n`);
  });
  it("copies the Callyzer base and key together or not at all", () => {
    writeFileSync(file("dest.env"), "");
    const r = copy(source(`CALLYZER_API_KEY=${CZ_KEY}\nDEEPGRAM_API_KEY=${DG_KEY}\n`));
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("CALLYZER_API_BASE is missing or empty in the source, so CALLYZER_API_KEY was not copied either");
    const dest = read("dest.env");
    expect(dest).not.toContain("CALLYZER_API_KEY");
    expect(dest).toContain(`DEEPGRAM_API_KEY=${DG_KEY}`);
  });
  it("treats an empty value as missing", () => {
    writeFileSync(file("dest.env"), "DEEPGRAM_API_KEY=keep-me\n");
    const r = copy(source(`CALLYZER_API_BASE=${BASE}\nCALLYZER_API_KEY=${CZ_KEY}\nDEEPGRAM_API_KEY=\n`));
    expect(r.stdout).toContain("DEEPGRAM_API_KEY is missing or empty in the source; not copied");
    expect(read("dest.env")).toContain("DEEPGRAM_API_KEY=keep-me");
  });
  it("names the base's host and warns when the calls job would refuse it", () => {
    writeFileSync(file("dest.env"), "");
    const r = copy(source(`CALLYZER_API_BASE=https://evil.example.com/api\nCALLYZER_API_KEY=${CZ_KEY}\n`));
    expect(r.stdout).toContain("CALLYZER_API_BASE host: evil.example.com (NOT allowed");
    expect(r.out).not.toContain(CZ_KEY);
  });
  it("refuses a source that does not exist", () => {
    const r = copy(file("missing.env"));
    expect(r.status).not.toBe(0);
    expect(read("dest.env")).toBe("");
  });
});

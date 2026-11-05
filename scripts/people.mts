// Manage who can sign in. Sign-ups are closed in Supabase, so this (or Settings > Team) is the only
// way in: adding someone creates their login and their team-list row in one go.
//
// Run from the project root (loads NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY from .env.local):
//   npx tsx --env-file=.env.local scripts/people.mts list
//   npx tsx --env-file=.env.local scripts/people.mts add --email name@dnyhospitality.com --name "Full Name" --role member [--dept ops]
//   npx tsx --env-file=.env.local scripts/people.mts deactivate --email name@dnyhospitality.com
//   npx tsx --env-file=.env.local scripts/people.mts reactivate --email name@dnyhospitality.com
//   npx tsx --env-file=.env.local scripts/people.mts test-link --email name@dnyhospitality.com [--site http://localhost:3200]
//
// Roles: admin (settings, team, retries) · member (everything else).
// test-link prints a one-time sign-in link on the app's own /auth/callback; no email is sent. It is a
// credential: paste it into a browser you control and nowhere else.

import { parseArgs } from "node:util";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "../src/lib/supabase/database.types";
import * as people from "../src/lib/auth/people-admin-core";

const USAGE = `Usage: npx tsx --env-file=.env.local scripts/people.mts <command> [options]

Commands
  list                                   everyone on the team list
  add --email <e> --name "<n>" --role admin|member [--dept <d>]
                                         add (or update and re-activate) a person and their login
  deactivate --email <e>                 remove access now (row inactive, login banned)
  reactivate --email <e>                 give access back
  test-link --email <e> [--site <url>]   print a one-time sign-in link (default site http://localhost:3200)`;

function fail(message: string): never {
  console.error(message);
  process.exit(2);
}

function need(value: string | undefined, flag: string): string {
  if (!value?.trim()) fail(`--${flag} is required\n\n${USAGE}`);
  return value;
}

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) fail("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY are not set; run with --env-file=.env.local");
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function main() {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      email: { type: "string" },
      name: { type: "string" },
      role: { type: "string" },
      dept: { type: "string" },
      site: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });
  const command = positionals[0];
  if (values.help || !command) {
    console.log(USAGE);
    process.exitCode = command ? 0 : 1;
    return;
  }

  const db = adminClient();

  switch (command) {
    case "list": {
      const rows = await people.listPeople(db);
      for (const p of rows) {
        const login = p.auth_user_id ? "can sign in" : "no login yet";
        console.log(`${p.active ? " " : "x"} ${p.role.padEnd(7)} ${p.full_name.padEnd(24)} ${p.email.padEnd(36)} ${(p.dept ?? "").padEnd(10)} ${login}`);
      }
      console.log(`\n${rows.length} people (x = deactivated)`);
      return;
    }
    case "add": {
      const role = need(values.role, "role");
      if (!people.ROLES.includes(role as people.PersonRole)) fail(`--role must be one of: ${people.ROLES.join(", ")}`);
      const person = await people.addPerson(db, {
        email: need(values.email, "email"),
        fullName: need(values.name, "name"),
        role: role as people.PersonRole,
        dept: values.dept,
      });
      console.log(`${person.full_name} (${person.email}) is on the team list as ${person.role}. They can sign in with Google or an email link now.`);
      return;
    }
    case "deactivate": {
      const person = await people.deactivatePerson(db, need(values.email, "email"));
      console.log(`Deactivated ${person.full_name} (${person.email}). Pages stop at once; their login is banned so it cannot refresh.`);
      return;
    }
    case "reactivate": {
      const person = await people.reactivatePerson(db, need(values.email, "email"));
      console.log(`Reactivated ${person.full_name} (${person.email}). They can sign in again.`);
      return;
    }
    case "test-link": {
      const site = (values.site ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3200").replace(/\/$/, "");
      const link = await people.generateTestLink(db, need(values.email, "email"), `${site}/auth/callback`);
      console.log(link);
      console.log("\nOpen this once in a browser you control. It signs that person in; treat it like a password.");
      return;
    }
    default:
      fail(`Unknown command "${command}"\n\n${USAGE}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

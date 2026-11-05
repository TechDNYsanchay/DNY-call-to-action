// The Settings > Clients import: one client per line, "name,domain1|domain2,email1|email2,status".
// Pure, so every odd line (quotes, blank cells, bad status) is unit tested before anything is saved.

export const CLIENT_STATUSES = ["active", "onboarding", "churned"] as const;
export type ClientStatus = (typeof CLIENT_STATUSES)[number];

export interface CsvClient {
  line: number;
  name: string;
  domains: string[];
  contact_emails: string[];
  status: ClientStatus;
}

export interface CsvProblem {
  line: number;
  message: string;
}

export interface CsvResult {
  rows: CsvClient[];
  problems: CsvProblem[];
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/;

/** "Taj.com | @oberoi.in" -> ["taj.com", "oberoi.in"]; shared by the CSV import and the client dialog. */
export const normaliseList = (cell: string | undefined): string[] => list(cell);

export const isClientStatus = (value: string): value is ClientStatus => (CLIENT_STATUSES as readonly string[]).includes(value);

/** Splits one CSV line on commas, honouring double quotes. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else cell += ch;
  }
  cells.push(cell);
  return cells.map((c) => c.trim());
}

const list = (cell: string | undefined): string[] => [...new Set((cell ?? "").split(/[|;\s]+/).map((v) => v.trim().toLowerCase().replace(/^@/, "")).filter(Boolean))];

const looksLikeHeader = (cells: string[]) => /^name$/i.test(cells[0] ?? "") && /domain/i.test(cells[1] ?? "");

export function parseClientsCsv(text: string): CsvResult {
  const rows: CsvClient[] = [];
  const problems: CsvProblem[] = [];
  const seen = new Set<string>();
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const cells = splitCsvLine(raw);
    if (index === 0 && looksLikeHeader(cells)) return;
    const name = cells[0]?.replace(/\s+/g, " ") ?? "";
    if (!name) return problems.push({ line, message: "The name is missing" }) && undefined;
    const key = name.toLowerCase();
    if (seen.has(key)) return problems.push({ line, message: `"${name}" appears more than once` }) && undefined;
    const domains = list(cells[1]);
    const emails = list(cells[2]);
    const badDomain = domains.find((d) => !DOMAIN.test(d));
    if (badDomain) return problems.push({ line, message: `"${badDomain}" is not a domain` }) && undefined;
    const badEmail = emails.find((e) => !EMAIL.test(e));
    if (badEmail) return problems.push({ line, message: `"${badEmail}" is not an email address` }) && undefined;
    const statusCell = (cells[3] ?? "").toLowerCase() || "active";
    if (!(CLIENT_STATUSES as readonly string[]).includes(statusCell)) return problems.push({ line, message: `Status must be one of ${CLIENT_STATUSES.join(", ")}, not "${cells[3]}"` }) && undefined;
    seen.add(key);
    rows.push({ line, name, domains, contact_emails: emails, status: statusCell as ClientStatus });
  });
  return { rows, problems };
}

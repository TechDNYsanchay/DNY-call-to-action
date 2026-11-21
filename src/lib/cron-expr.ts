// Checks a cron expression against the syntax Vercel documents, because `next build` does not validate
// vercel.json and a bad schedule only shows up at deploy time. Pure.
// Five fields (minute hour day-of-month month day-of-week); only digits, *, commas, ranges and steps;
// no names, L, W, # or ?; and day-of-month and day-of-week may not both be restricted.

const FIELDS: Array<[min: number, max: number]> = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week
];

const inRange = (n: number, [min, max]: [number, number]) => Number.isInteger(n) && n >= min && n <= max;

function validPart(part: string, range: [number, number]): boolean {
  const [base, step, ...rest] = part.split("/");
  if (rest.length) return false;
  if (step !== undefined && (!/^\d+$/.test(step) || Number(step) < 1 || Number(step) > range[1])) return false;
  if (base === "*") return true;
  const bounds = base.match(/^(\d+)(?:-(\d+))?$/);
  if (!bounds) return false;
  const from = Number(bounds[1]);
  const to = bounds[2] === undefined ? from : Number(bounds[2]);
  // A step needs a range ("a-b/n"); "a/n" is not in Vercel's syntax.
  if (step !== undefined && bounds[2] === undefined) return false;
  return inRange(from, range) && inRange(to, range) && from <= to;
}

export function isValidVercelCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  if (!fields.every((field, i) => /^[\d*,\-/]+$/.test(field) && field.split(",").every((part) => validPart(part, FIELDS[i])))) return false;
  return fields[2] === "*" || fields[4] === "*";
}

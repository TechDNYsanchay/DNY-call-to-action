// Zod issues as "path: message" lines the routine can act on. Pure.

import type { z } from "zod";

export const MAX_ISSUES = 20;

export function zodIssues(error: z.ZodError, max = MAX_ISSUES): string[] {
  const lines = error.issues.slice(0, max).map((i) => `${i.path.length ? i.path.map(String).join(".") : "(root)"}: ${i.message}`);
  if (error.issues.length > max) lines.push(`... and ${error.issues.length - max} more schema problems; fix these first and check again`);
  return lines;
}

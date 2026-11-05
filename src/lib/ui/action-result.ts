// The shape every server action returns, so client components can toast the plain reason instead
// of catching a thrown error (which Next.js masks in production).

export type ActionResult<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

export const ok = <T>(data?: T): ActionResult<T> => ({ ok: true, data });

export const failed = (error: unknown, fallback = "Couldn't save. Please try again."): { ok: false; error: string } => ({
  ok: false,
  error: error instanceof Error && error.message ? error.message : fallback,
});

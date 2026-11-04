// Retries Supabase requests once or twice on transient failures (network errors, 5xx), so a blip
// in the Mumbai region does not surface as a broken page. Never retries non-idempotent errors.

const RETRY_STATUSES = new Set([502, 503, 504]);

export const retryingFetch: typeof fetch = async (input, init) => {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(input, init);
      if (!RETRY_STATUSES.has(response.status) || attempt === 2) return response;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((r) => setTimeout(r, 150 * 2 ** attempt));
  }
  throw lastError ?? new Error("fetch failed");
};

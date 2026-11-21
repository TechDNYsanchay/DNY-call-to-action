// Stands in for next/headers in the e2e suite: no request, so no cookies and no headers.
export async function cookies() {
  return { getAll: () => [], get: () => undefined, set: () => undefined };
}

export async function headers() {
  return new Headers();
}

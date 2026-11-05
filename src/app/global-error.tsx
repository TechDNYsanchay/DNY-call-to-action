"use client";

// Last resort when the root layout itself fails: must render its own <html> and <body>.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#e8ebe7", color: "#14201a" }}>
        <main style={{ maxWidth: 400, margin: "0 auto", padding: "64px 16px" }}>
          <p style={{ fontWeight: 600 }}>Call to Action</p>
          <h1 style={{ fontSize: 22, fontWeight: 500, marginTop: 24 }}>The app could not start</h1>
          <p style={{ color: "#4f5b54", lineHeight: 1.5 }}>{error.message || "Something went wrong before the page could render."}</p>
          <button type="button" onClick={() => reset()} style={{ marginTop: 16, height: 40, padding: "0 14px", borderRadius: 6, border: "1px solid #b8c0b6", background: "#fff", color: "#14201a", fontWeight: 500 }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}

"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { type ImportSummary, importClientsCsv } from "@/app/(app)/clients/actions";
import { parseClientsCsv } from "@/lib/ui/csv";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/fields";
import { useToast } from "@/components/ui/toast";

// Paste "name,domain1|domain2,email1|email2,status" lines, see exactly what will be saved, then save.
// The preview runs the same parser the server uses, so nothing surprising lands.

export function CsvImport() {
  const router = useRouter();
  const toast = useToast();
  const [text, setText] = useState("");
  const [result, setResult] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const preview = useMemo(() => parseClientsCsv(text), [text]);

  const save = () =>
    start(async () => {
      setError(null);
      const res = await importClientsCsv(text);
      if (!res.ok) return setError(res.error);
      setResult(res.data ?? null);
      setText("");
      toast({ message: `${res.data?.created ?? 0} added, ${res.data?.updated ?? 0} updated` });
      router.refresh();
    });

  return (
    <div className="flex flex-col gap-3">
      <Field label="CSV lines" htmlFor="clients-csv" hint="name,domain1|domain2,email1|email2,status — status is active, onboarding or churned (default active). A header line is fine. Existing names are updated, not duplicated.">
        <Textarea id="clients-csv" value={text} onChange={(e) => setText(e.target.value)} placeholder={"Saffron Court Hotel,saffroncourt.in,gm@saffroncourt.in|rakesh@gmail.com,active"} />
      </Field>

      {text.trim() && (
        <div className="rounded-card border border-hairline">
          <p className="border-b border-hairline px-3 py-2 text-[12px] font-semibold text-ink-3">
            Preview · {preview.rows.length} to save{preview.problems.length ? ` · ${preview.problems.length} skipped` : ""}
          </p>
          <ul className="max-h-[240px] divide-y divide-hairline overflow-y-auto text-[13px]">
            {preview.rows.map((r) => (
              <li key={r.line} className="flex flex-wrap items-baseline gap-x-3 px-3 py-1.5">
                <span className="font-medium text-ink">{r.name}</span>
                <span className="font-mono text-[12px] text-ink-2">{r.domains.join(", ") || "no domains"}</span>
                <span className="font-mono text-[12px] text-ink-3">{r.contact_emails.join(", ")}</span>
                <span className="ml-auto text-ink-3">{r.status}</span>
              </li>
            ))}
            {preview.problems.map((p) => (
              <li key={`p${p.line}`} className="px-3 py-1.5 text-signal">
                Line {p.line}: {p.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-signal">
          {error}
        </p>
      )}
      {result && !text && (
        <p role="status" className="text-[13px] text-ink-2">
          Saved: {result.created} added, {result.updated} updated{result.problems.length ? `, ${result.problems.length} line${result.problems.length === 1 ? "" : "s"} skipped` : ""}.
        </p>
      )}
      <div>
        <Button variant="primary" onClick={save} disabled={pending || preview.rows.length === 0}>
          {pending ? "Saving…" : `Save ${preview.rows.length || ""} ${preview.rows.length === 1 ? "client" : "clients"}`.replace(/\s+/g, " ")}
        </Button>
      </div>
    </div>
  );
}

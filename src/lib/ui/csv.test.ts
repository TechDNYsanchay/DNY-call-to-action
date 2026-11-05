import { describe, expect, it } from "vitest";
import { parseClientsCsv, splitCsvLine } from "./csv";

describe("clients CSV", () => {
  it("splits quoted cells", () => {
    expect(splitCsvLine('"Taj, Lands End",tajhotels.com|taj.in,gm@tajhotels.com,active')).toEqual(["Taj, Lands End", "tajhotels.com|taj.in", "gm@tajhotels.com", "active"]);
    expect(splitCsvLine('a,"say ""hi""",c')).toEqual(["a", 'say "hi"', "c"]);
  });

  it("parses rows, skips a header and blank lines, defaults the status", () => {
    const { rows, problems } = parseClientsCsv("name,domains,emails,status\nSaffron Court,saffroncourt.in,GM@saffroncourt.in|rakesh@gmail.com,onboarding\n\nBlue Bay,bluebay.in\n");
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      { line: 2, name: "Saffron Court", domains: ["saffroncourt.in"], contact_emails: ["gm@saffroncourt.in", "rakesh@gmail.com"], status: "onboarding" },
      { line: 4, name: "Blue Bay", domains: ["bluebay.in"], contact_emails: [], status: "active" },
    ]);
  });

  it("reports problems with the line number and keeps the good rows", () => {
    const { rows, problems } = parseClientsCsv(",x.com\nA,not a domain\nB,b.com,nobody\nC,c.com,,gone\nD,d.com\nd,dd.com");
    expect(rows.map((r) => r.name)).toEqual(["D"]);
    expect(problems.map((p) => p.line)).toEqual([1, 2, 3, 4, 6]);
    expect(problems[1].message).toContain("not a domain");
    expect(problems[4].message).toContain("more than once");
  });
});

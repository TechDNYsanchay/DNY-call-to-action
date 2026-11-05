import { describe, expect, it } from "vitest";
import { domainOf, firstName, hasDevanagari, initials, nameFromEmail, plural } from "./text";

describe("text helpers", () => {
  it("builds initials from names, then emails", () => {
    expect(initials("Priya Nair")).toBe("PN");
    expect(initials("Rakesh Agrawal (Hotel Sunrise)")).toBe("RA");
    expect(initials("Vikram")).toBe("V");
    expect(initials(null, "gm@saffroncourt.in")).toBe("G");
    expect(initials(null, null)).toBe("?");
  });

  it("guesses a name from an email", () => {
    expect(nameFromEmail("priya.nair@dnyhospitality.com")).toBe("Priya Nair");
    expect(nameFromEmail(null)).toBeNull();
  });

  it("detects Devanagari and pluralises", () => {
    expect(hasDevanagari("Agle Budhvar theek hai")).toBe(false);
    expect(hasDevanagari("अगले बुधवार")).toBe(true);
    expect(plural(1, "item")).toBe("1 item");
    expect(plural(3, "item")).toBe("3 items");
    expect(firstName("Priya Nair")).toBe("Priya");
    expect(domainOf("gm@Saffron.in")).toBe("saffron.in");
  });
});

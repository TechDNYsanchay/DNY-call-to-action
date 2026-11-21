import { describe, expect, it } from "vitest";
import { lineDisplayName, lineWithPeople, titleCaseName } from "./line-name";

const keyur = { label: null, callyzer_name: "keyur dny supply chain" };

describe("lineDisplayName", () => {
  it("prefers the admin's label", () => {
    expect(lineDisplayName({ label: "Supply desk", callyzer_name: "keyur dny supply chain" }, [{ full_name: "Keyur Shah" }])).toBe("Supply desk");
  });

  it("names a one-person line after that person", () => {
    expect(lineDisplayName({ label: null, callyzer_name: "Ashwini Bhambani" }, [{ full_name: "Ashwini Bhambani" }])).toBe("Ashwini's phone");
    expect(lineDisplayName({ label: "  ", callyzer_name: "x" }, [{ full_name: "Meera Iyer" }])).toBe("Meera's phone");
  });

  it("falls back to Callyzer's name, title-cased, when nobody or several people use it", () => {
    expect(lineDisplayName(keyur, [])).toBe("Keyur Dny Supply Chain");
    expect(lineDisplayName(keyur, [{ full_name: "Keyur Shah" }, { full_name: "Meera Iyer" }])).toBe("Keyur Dny Supply Chain");
    expect(titleCaseName("  DNY  ops ")).toBe("DNY Ops");
  });
});

describe("lineWithPeople", () => {
  it("adds the people's first names, never twice", () => {
    expect(lineWithPeople(keyur, [{ full_name: "Keyur Shah" }, { full_name: "Meera Iyer" }])).toBe("Keyur Dny Supply Chain (Keyur, Meera)");
    expect(lineWithPeople({ label: "Supply desk", callyzer_name: "x" }, [{ full_name: "Keyur Shah" }])).toBe("Supply desk (Keyur)");
    expect(lineWithPeople({ label: null, callyzer_name: "Ashwini Bhambani" }, [{ full_name: "Ashwini Bhambani" }])).toBe("Ashwini's phone");
    expect(lineWithPeople(keyur, [])).toBe("Keyur Dny Supply Chain");
  });
});

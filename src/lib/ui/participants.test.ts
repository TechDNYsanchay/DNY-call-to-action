import { describe, expect, it } from "vitest";
import { attendeesOf, externalIdentities, groupBySide } from "./participants";

const p = (email: string, is_dny: boolean, name: string | null = null) => ({ email, name, domain: email.split("@")[1], is_dny, is_organizer: false });

describe("participants", () => {
  it("remembers company domains but personal addresses in full", () => {
    expect(externalIdentities([p("priya@dnyhospitality.com", true), p("gm@saffroncourt.in", false), p("rakesh@gmail.com", false), p("GM@saffroncourt.in", false)])).toEqual(["saffroncourt.in", "rakesh@gmail.com"]);
    expect(externalIdentities([p("a@dnyhospitality.com", true)])).toEqual([]);
  });

  it("sides attendees by the meeting type", () => {
    const list = attendeesOf([p("a@dnyhospitality.com", true, "A"), p("b@x.com", false, "B")], "client");
    expect(list.map((a) => a.side)).toEqual(["dny", "client"]);
    expect(attendeesOf([p("b@x.com", false)], "unknown")[0].side).toBe("unknown");
    const grouped = groupBySide(list);
    expect(grouped.dny.length).toBe(1);
    expect(grouped.client.length).toBe(1);
  });
});

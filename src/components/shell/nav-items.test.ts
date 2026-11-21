import { describe, expect, it } from "vitest";
import { navItems, tabItems } from "./nav-items";

describe("navItems", () => {
  it("puts Calls right after Meetings, with its decisions badge, when calls are visible", () => {
    const items = navItems(2, true, { visible: true, decisions: 3 });
    expect(items.map((i) => i.key)).toEqual(["meetings", "calls", "book", "review", "mine", "clients", "settings"]);
    expect(items[1]).toEqual({ key: "calls", href: "/calls", label: "Calls", short: "Calls", badge: 3 });
  });

  it("gives phones six tabs with Calls on, Book included and Settings behind the avatar", () => {
    const tabs = tabItems(navItems(0, true, { visible: true, decisions: 0 }));
    expect(tabs.map((t) => t.key)).toEqual(["meetings", "calls", "book", "review", "mine", "clients"]);
  });

  it("is exactly today's list when calls are hidden or unknown", () => {
    const today = ["meetings", "book", "review", "mine", "clients", "settings"];
    expect(navItems(1, true).map((i) => i.key)).toEqual(today);
    expect(navItems(1, true, { visible: false, decisions: 4 }).map((i) => i.key)).toEqual(today);
    expect(tabItems(navItems(1, false, { visible: false, decisions: 0 })).map((i) => i.key)).toEqual(["meetings", "book", "review", "mine", "clients"]);
    expect(navItems(5, false).find((i) => i.key === "review")?.badge).toBe(5);
  });
});

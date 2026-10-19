// The derivation of placements and memberships from lifecycle events (adatmodell 7.; T-09, DAT-05).
import { describe, expect, it } from "vitest";
import { deriveLifecycle } from "@/lib/animals";

const t = (h: number) => new Date(Date.UTC(2026, 5, 1, h));
const ev = (id: string, type: string, h: number, toPoolId: string | null = null, toGroupId: string | null = null) =>
  ({ id, type, occurredAt: t(h), toPoolId, toGroupId }) as Parameters<typeof deriveLifecycle>[0][number];

describe("deriveLifecycle", () => {
  it("arrival, transfer, group change, death: closed intervals, nothing open after the end", () => {
    const r = deriveLifecycle([
      ev("a", "ARRIVAL", 1, "P1", "G1"),
      ev("b", "TRANSFER", 5, "P2"),
      ev("c", "GROUP_CHANGE", 7, null, "G2"),
      ev("d", "DEATH", 9),
    ]);
    if ("error" in r) throw new Error(r.error);
    expect(r.placements).toEqual([
      { poolId: "P1", validFrom: t(1), validTo: t(5), eventId: "a" },
      { poolId: "P2", validFrom: t(5), validTo: t(9), eventId: "b" },
    ]);
    expect(r.memberships).toEqual([
      { groupId: "G1", validFrom: t(1), validTo: t(7), eventId: "a" },
      { groupId: "G2", validFrom: t(7), validTo: t(9), eventId: "c" },
    ]);
  });

  it("a group change to no group ends the membership; the history stays (V-14)", () => {
    const r = deriveLifecycle([ev("a", "ARRIVAL", 1, "P1", "G1"), ev("b", "GROUP_CHANGE", 3)]);
    if ("error" in r) throw new Error(r.error);
    expect(r.memberships).toEqual([{ groupId: "G1", validFrom: t(1), validTo: t(3), eventId: "a" }]);
    expect(r.placements[0].validTo).toBeNull();
  });

  it.each([
    [[ev("b", "TRANSFER", 2, "P2")], "érkezésnek"],
    [[ev("a", "ARRIVAL", 1, "P1"), ev("d", "DEATH", 2), ev("b", "TRANSFER", 3, "P2")], "Elhullás vagy kiadás után"],
    [[ev("a", "ARRIVAL", 1, "P1"), ev("a2", "ARRIVAL", 2, "P2")], "csak egy érkezése"],
    [[ev("a", "ARRIVAL", 1, null)], "medence kell"],
    [[ev("a", "ARRIVAL", 1, "P1"), ev("b", "TRANSFER", 2, "P1")], "már ebben a medencében"],
  ])("refuses a contradiction (%#)", (events, text) => {
    const r = deriveLifecycle(events);
    expect("error" in r && r.error).toContain(text);
  });
});

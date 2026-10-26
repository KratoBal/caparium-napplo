// The named feeding lists' input (Lili 2026-10-26, Caparium channel msg 1564356412946124921, item 1): a name, at least one
// member (an animal or a feed), each an id, the same one counted once.
import { describe, expect, it } from "vitest";
import { applyListSchema, createListSchema, updateListSchema } from "@/lib/feeding-lists";

const A = "00000000-0000-4000-8000-0000000000a1";
const F = "00000000-0000-4000-8000-0000000000f1";
const ok = { requestId: "req-00000001", name: "Puhatestű nap", animalIds: [A], feedIds: [F] };

describe("feeding list input", () => {
  it("takes a name and members; either kind of member is enough", () => {
    expect(createListSchema.safeParse(ok).success).toBe(true);
    expect(createListSchema.safeParse({ ...ok, feedIds: [] }).success).toBe(true);
    expect(createListSchema.safeParse({ ...ok, animalIds: [] }).success).toBe(true);
  });

  it("refuses an empty list, a short name, and anything that is not an id", () => {
    const empty = createListSchema.safeParse({ ...ok, animalIds: [], feedIds: [] });
    expect(empty.success).toBe(false);
    expect(JSON.stringify(empty.error?.issues)).toContain("Legalább egy állatot vagy takarmányt");
    expect(createListSchema.safeParse({ ...ok, name: " x " }).success).toBe(false);
    expect(createListSchema.safeParse({ ...ok, name: "x".repeat(61) }).success).toBe(false);
    expect(createListSchema.safeParse({ ...ok, animalIds: ["Teszt Egy"] }).success).toBe(false);
  });

  it("counts a repeated member once and trims the name", () => {
    const parsed = createListSchema.parse({ ...ok, name: "  Puhatestű nap ", animalIds: [A, A], feedIds: [F, F] });
    expect([parsed.name, parsed.animalIds, parsed.feedIds]).toEqual(["Puhatestű nap", [A], [F]]);
  });

  it("an update names its list; applying needs a list and a day", () => {
    expect(updateListSchema.safeParse(ok).success).toBe(false);
    expect(updateListSchema.safeParse({ ...ok, listId: A }).success).toBe(true);
    expect(applyListSchema.safeParse({ requestId: "req-00000001", day: "2027-11-08", listId: A }).success).toBe(true);
    expect(applyListSchema.safeParse({ requestId: "req-00000001", day: "tegnap", listId: A }).success).toBe(false);
    // no list at all is allowed (the header's switch off: the whole selection is taken off); the confirmation passes through
    expect(applyListSchema.safeParse({ requestId: "req-00000001", day: "2027-11-08", listId: null }).success).toBe(true);
    expect(applyListSchema.safeParse({ requestId: "req-00000001", day: "2027-11-08", listId: A, confirmCascade: true }).success).toBe(true);
    expect(applyListSchema.safeParse({ requestId: "req-00000001", day: "2027-11-08" }).success, "the list id is stated, null or an id").toBe(false);
    // the later steps append ":off" and ":feeds": a longer id is refused up front, not half way
    expect(applyListSchema.safeParse({ requestId: "r".repeat(90), day: "2027-11-08", listId: A }).success).toBe(true);
    expect(applyListSchema.safeParse({ requestId: "r".repeat(91), day: "2027-11-08", listId: A }).success).toBe(false);
  });
});

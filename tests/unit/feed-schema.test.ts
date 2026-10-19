import { describe, expect, it } from "vitest";
import { createFeedSchema } from "@/lib/feeds";

// The "Új takarmány" form with an empty type list sent typeId "" and showed the raw "Invalid UUID"
// (Balázs, 2026-10-19): the answer names the missing choice instead.
const valid = {
  requestId: "kerés-azonosító-1",
  typeId: "3f2b8c1e-0d5a-4b7e-9c1f-2a6d8e4b0c11",
  name: "Makréla",
  dimensions: ["MASS"],
  defaultUnitId: "7a1c3e5f-2b4d-4f6a-8c0e-1d3b5f7a9c22",
};

const messages = (input: unknown) => {
  const r = createFeedSchema.safeParse(input);
  return r.success ? [] : r.error.issues.map((i) => i.message);
};

describe("the new feed's choices", () => {
  it("a valid body passes", () => {
    expect(messages(valid)).toEqual([]);
  });

  it("an empty type says to choose a type, not Invalid UUID", () => {
    expect(messages({ ...valid, typeId: "" })).toEqual(["Válassz takarmánytípust."]);
  });

  it("an empty unit says to choose a unit", () => {
    expect(messages({ ...valid, defaultUnitId: "" })).toEqual(["Válassz alapértelmezett egységet."]);
  });
});

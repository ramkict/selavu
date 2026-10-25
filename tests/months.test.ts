import { beforeAll, describe, expect, it } from "vitest";
import type { Db } from "@/server/db";
import { addConfiguredMonth, listConfiguredMonths } from "@/server/domain/months";
import { freshDb, ctx } from "./helpers";

describe("configured months", () => {
  let db: Db;

  beforeAll(async () => {
    db = await freshDb();
  });

  it("seeds all 2026 months and only adds unique future months", async () => {
    const months = await db.$transaction(listConfiguredMonths);
    expect(months).toHaveLength(12);
    expect(months[0]).toBe("2026-01");
    expect(months.at(-1)).toBe("2026-12");

    expect(await db.$transaction((tx) => addConfiguredMonth(tx, "2027-01", ctx))).toBe("2027-01");
    await expect(db.$transaction((tx) => addConfiguredMonth(tx, "2027-01", ctx))).rejects.toMatchObject({ status: 409 });
    await expect(db.$transaction((tx) => addConfiguredMonth(tx, "2026-10", ctx))).rejects.toMatchObject({ status: 422 });
    await expect(db.$transaction((tx) => addConfiguredMonth(tx, "2026-13", ctx))).rejects.toMatchObject({ status: 400 });
  });
});
import { describe, expect, it } from "vitest";
import { isDue, missedPeriods, nextDue } from "./schedule.js";

const T0 = new Date("2026-10-09T10:00:00.000Z");

describe("nextDue", () => {
  it("fires a once-job when its time has come, not before", () => {
    expect(nextDue({ kind: "once", at: "2026-10-09T10:05:00.000Z" }, null, T0)).toBeNull();
    expect(nextDue({ kind: "once", at: "2026-10-09T09:55:00.000Z" }, null, T0)).toEqual(
      new Date("2026-10-09T09:55:00.000Z"),
    );
  });

  it("fires a new recurring job immediately, then on period", () => {
    expect(nextDue({ kind: "every", seconds: 60 }, null, T0)).toEqual(T0);
    expect(nextDue({ kind: "every", seconds: 60 }, new Date("2026-10-09T10:00:00.000Z"), T0)).toEqual(
      new Date("2026-10-09T10:01:00.000Z"),
    );
  });

  it("honors an explicit from for new recurring jobs", () => {
    expect(
      nextDue({ kind: "every", seconds: 60, from: "2026-10-09T11:00:00.000Z" }, null, T0),
    ).toEqual(new Date("2026-10-09T11:00:00.000Z"));
  });
});

describe("isDue / missedPeriods", () => {
  it("counts skipped periods without replaying them", () => {
    const spec = { kind: "every" as const, seconds: 60 };
    const after = new Date("2026-10-09T10:00:00.000Z");
    expect(isDue(spec, after, new Date("2026-10-09T10:01:00.000Z"))).toBe(true);
    expect(isDue(spec, after, new Date("2026-10-09T10:00:30.000Z"))).toBe(false);
    expect(missedPeriods(spec, after, new Date("2026-10-09T10:05:00.000Z"))).toBe(4);
    expect(missedPeriods(spec, after, new Date("2026-10-09T10:01:00.000Z"))).toBe(0);
    expect(missedPeriods({ kind: "once", at: "2026-10-09T09:00:00.000Z" }, after, T0)).toBe(0);
  });
});

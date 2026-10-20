import { describe, expect, it } from "vitest";
import { checkWatchTargets, candidateHash } from "./watcher.js";
import { WatchSchema } from "./store.js";

describe("watch schema", () => {
  it("accepts a plain-language watch and defaults the rest", () => {
    const w = WatchSchema.parse({ name: "upsc vacancies", targets: ["https://upsc.gov.in/vacancy-circulars"] });
    expect(w.terms).toEqual([]);
    expect(w.intervalMinutes).toBe(0);
    expect(w.allowedDomains).toEqual([]);
  });

  it("rejects a watch without targets", () => {
    expect(() => WatchSchema.parse({ name: "x", targets: [] })).toThrowError();
  });
});

describe("candidate hashing", () => {
  it("is stable for the same title+url and differs otherwise", () => {
    const a = candidateHash({ title: "Vacancy 2026", url: "https://x.gov/1", summary: null });
    const b = candidateHash({ title: "vacancy 2026", url: "https://X.GOV/1", summary: null });
    const c = candidateHash({ title: "Vacancy 2027", url: "https://x.gov/1", summary: null });
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe("checkWatchTargets", () => {
  it("reports fetch errors instead of throwing", async () => {
    const res = await checkWatchTargets(["http://127.0.0.1:1/nope"], [], [], 500);
    expect(res.candidates).toHaveLength(0);
    expect(res.errors.length).toBe(1);
  });
});

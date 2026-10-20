import { describe, expect, it } from "vitest";
import { isOfficialUrl, sourceById } from "./sources.js";
import { extractApplyLink, parseListingLinks, parseRss } from "./harvest.js";
import { matchEligibility } from "./profile.js";

const upsc = sourceById("upsc-vacancies");

describe("authenticity gate", () => {
  it("accepts the publisher's own domain and its subdomains", () => {
    expect(isOfficialUrl("https://upsc.gov.in/vacancy-circulars", upsc!)).toBe(true);
    expect(isOfficialUrl("https://www.upsc.gov.in/x", upsc!)).toBe(true);
  });

  it("rejects look-alike and media domains even when the text looks official", () => {
    expect(isOfficialUrl("https://upsc.gov.in.evil.com/ssc-cgl", upsc!)).toBe(false);
    expect(isOfficialUrl("https://timesofindia.indiatimes.com/upsc-vacancy", upsc!)).toBe(false);
    expect(isOfficialUrl("https://ssc.gov.in/x", upsc!)).toBe(false);
  });
});

describe("listing parser", () => {
  it("keeps job documents and drops navigation/keys", () => {
    const html = `<a href="/files/Advt-01-2026.pdf">Advertisement No. 01/2026</a>
      <a href="/answer-key">Answer Key 2026</a>
      <a href="/cutoff">Cut-off Marks</a>
      <a href="/notif">Vacancy Notification Engineering</a>`;
    const links = parseListingLinks(html, "https://upsc.gov.in/", ["vacancy", "advertisement", "notification"], ["answer key", "cut-off"]);
    const urls = links.map((l) => l.url);
    expect(urls).toContain("https://upsc.gov.in/files/Advt-01-2026.pdf");
    expect(urls).toContain("https://upsc.gov.in/notif");
    expect(urls.some((u) => u.includes("answer-key"))).toBe(false);
    expect(urls.some((u) => u.includes("cutoff"))).toBe(false);
  });
});

describe("apply link extraction", () => {
  it("returns the official apply link, never a third-party one", () => {
    const html = `<a href="https://upsc.gov.in/apply-online">Apply Online</a>
      <a href="https://applyoutsider.com/x">Apply</a>`;
    const link = extractApplyLink(html, "https://upsc.gov.in/notice", upsc!, ["apply online", "apply"]);
    expect(link).toBe("https://upsc.gov.in/apply-online");
  });
});

describe("rss parser", () => {
  it("reads item title, link and date", () => {
    const xml = `<rss><channel><item><title>Junior Engineer Vacancy</title>
      <link>https://ssc.gov.in/je-adv</link>
      <description>Advt for JE posts</description>
      <pubDate>Tue, 06 Jan 2026 10:00:00 GMT</pubDate></item></channel></rss>`;
    const items = parseRss(xml, "https://ssc.gov.in/");
    expect(items[0]?.title).toBe("Junior Engineer Vacancy");
    expect(items[0]?.url).toBe("https://ssc.gov.in/je-adv");
  });
});

describe("eligibility matching", () => {
  const profile = {
    field: "computer science engineering",
    qualifications: ["b.tech", "b.e."],
    categories: ["general", "obc"],
    extraKeywords: ["engineer", "information technology"],
    excludedKeywords: ["result", "merit list"],
    graduationYears: [2024, 2025],
  };

  it("scores an engineering opening for an engineer", () => {
    const m = matchEligibility(profile, "Junior Engineer (Computer Science) Advertisement", "B.Tech required, age limit 32 years");
    expect(m.verdict).toBe("likely");
    expect(m.reasons.join(" ")).toMatch(/field/);
  });

  it("marks non-engineering posts unlikely", () => {
    const m = matchEligibility(profile, "Vacancy for Administrative Officer", "Graduation in any discipline");
    expect(m.verdict).not.toBe("likely");
  });

  it("excludes result/merit notices outright", () => {
    const m = matchEligibility(profile, "Junior Engineer Result 2026", "");
    expect(m.verdict).toBe("unlikely");
    expect(m.reasons[0]).toMatch(/result/);
  });
});

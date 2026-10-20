// Official-source registry. Every entry names its PUBLISHER and the exact
// domains that count as authentic for it. The harvester refuses any URL
// outside those domains, so media/blog/aggregator links can never enter the
// pipeline — that is the "authentic source" rule, enforced in code.
//
// kind:
//   html = server-rendered listing page; links matching linkKeywords are
//          treated as notification documents
//   rss  = RSS/Atom feed; <item> entries are notification documents
//   json = official JSON API (SPA sites); field mapping given by json*
export type SourceKind = "html" | "rss" | "json";

export interface OfficialSource {
  id: string;
  org: string; // publisher, e.g. "Staff Selection Commission"
  name: string; // human label
  homepage: string;
  listingUrl: string;
  kind: SourceKind;
  // Domain allowlist — absolute authority for this source. Include the
  // bare domain plus any subdomains are matched by suffix check.
  domains: string[];
  // Link/entry text that indicates a job/exam notification.
  linkKeywords: string[];
  // Link text that looks like a job opening but is NOT (navigation, keys,
  // results). Precision beats recall: a noisy feed is a worse product than
  // an empty one.
  linkExclude?: string[];
  // Phrases that mark an application link on the detail page.
  applyPhrases: string[];
  // Optional JSON API specifics (kind=json).
  jsonListPath?: string;
  jsonTitleField?: string;
  jsonLinkField?: string;
  jsonDateField?: string;
  note?: string;
}

// Strong signals: these are the words an actual circular/advertisement uses.
const JOB_WORDS = [
  "advertisement", "notification", "circular", "vacancy", "recruitment",
  "advt", "adv no", "notice", "examination scheme", "combined higher",
  "junior engineer", "graduate level", "technician", "selection post",
  "engineering services", "staff selection", "railway recruitment",
  "group d", "alp", "je ", "cgl", "chsl", "graduate engineer",
];

// Noise: navigation, answer keys, results — never an "opening".
const NOISE_WORDS = [
  "answer key", "cut-off", "cutoff", "cut off", "question paper", "question papers",
  "mark sheet", "merit list", "admit card", "result", "results", "calendar",
  "previous exam", "active examination", "forthcoming examination", "apply online",
  "apply now", "home", "about us", "contact us", "feedback", "faq", "sitemap",
  "previous question", "press release", "speech", "newsletter", "rss", "login",
];

// Phrases that mark an application link on the detail page.
const APPLY_WORDS = [
  "apply online", "online application", "apply now", "apply", "registration",
  "submit application", "application form",
];

// Sources reachable and relevant for engineering government jobs. Reachability
// varies by network — the harvester reports per-source failures and keeps
// going, so one blocked source never stops the others.
export const OFFICIAL_SOURCES: OfficialSource[] = [
  {
    id: "upsc-vacancies",
    org: "Union Public Service Commission",
    name: "UPSC Vacancy Circulars",
    homepage: "https://upsc.gov.in/",
    listingUrl: "https://upsc.gov.in/vacancy-circulars",
    kind: "html",
    domains: ["upsc.gov.in"],
    linkKeywords: JOB_WORDS,
    linkExclude: NOISE_WORDS,
    applyPhrases: APPLY_WORDS,
  },
  {
    id: "upsc-exams",
    org: "Union Public Service Commission",
    name: "UPSC Exam Notifications",
    homepage: "https://upsc.gov.in/",
    listingUrl: "https://upsc.gov.in/exams-related-info/exam-notification",
    kind: "html",
    domains: ["upsc.gov.in"],
    linkKeywords: JOB_WORDS,
    linkExclude: NOISE_WORDS,
    applyPhrases: APPLY_WORDS,
  },
  {
    id: "ssc-notifications",
    org: "Staff Selection Commission",
    name: "SSC Notice Board",
    homepage: "https://ssc.gov.in/",
    listingUrl: "https://ssc.gov.in/pages/notification",
    kind: "json",
    domains: ["ssc.gov.in"],
    linkKeywords: JOB_WORDS,
    linkExclude: NOISE_WORDS,
    applyPhrases: APPLY_WORDS,
    jsonListPath: "data",
    jsonTitleField: "title",
    jsonLinkField: "url",
    jsonDateField: "date",
    note: "SPA site: needs its JSON API path; listing falls back to the notice board page.",
  },
  {
    id: "niti-rss",
    org: "NITI Aayog",
    name: "NITI Aayog updates (RSS)",
    homepage: "https://www.niti.gov.in/",
    listingUrl: "https://www.niti.gov.in/rss.xml",
    kind: "rss",
    domains: ["niti.gov.in"],
    linkKeywords: JOB_WORDS,
    linkExclude: NOISE_WORDS,
    applyPhrases: APPLY_WORDS,
    note: "Policy feed — useful as a pipeline test, not a job board.",
  },
  {
    id: "rrb-notifications",
    org: "Railway Recruitment Boards",
    name: "RRB Notifications",
    homepage: "https://www.rrb.gov.in/",
    listingUrl: "https://www.rrb.gov.in/en/notifications/",
    kind: "html",
    domains: ["rrb.gov.in"],
    linkKeywords: JOB_WORDS,
    linkExclude: NOISE_WORDS,
    applyPhrases: APPLY_WORDS,
    note: "Central for ALP/Group D/JE — frequently unreachable; retried each cycle.",
  },
  {
    id: "ibps-notifications",
    org: "Institute of Banking Personnel Selection",
    name: "IBPS Recruitment",
    homepage: "https://www.ibps.in/",
    listingUrl: "https://www.ibps.in/category/recruitment-notifications/",
    kind: "html",
    domains: ["ibps.in"],
    linkKeywords: JOB_WORDS,
    linkExclude: NOISE_WORDS,
    applyPhrases: APPLY_WORDS,
  },
];

export function sourceById(id: string): OfficialSource | undefined {
  return OFFICIAL_SOURCES.find((s) => s.id === id);
}

// Suffix check on the HOST only. This is the authenticity gate: a link to
// "timesofindia.indiatimes.com/ssc-cgl" is NOT ssc.gov.in, whatever its
// text says.
export function isOfficialUrl(url: string, source: OfficialSource): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  return source.domains.some(
    (d) => host === d.toLowerCase() || host.endsWith(`.${d.toLowerCase()}`),
  );
}

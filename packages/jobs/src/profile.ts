// The user's profile: what they can apply to. Kept small and explicit —
// eligibility claims in notifications stay OFFICIAL facts, and the match is
// our INFERENCE, labelled as such.
export interface UserProfile {
  field: string; // e.g. "computer science engineering"
  qualifications: string[]; // e.g. ["b.tech", "b.e."]
  graduationYears?: number[] | undefined; // eligible graduation years, if known
  ageLimit?: { min?: number | undefined; max?: number | undefined } | undefined;
  categories: string[]; // e.g. ["general", "obc", "sc", "st", "ews"]
  states?: string[] | undefined; // preferred states
  extraKeywords: string[]; // anything else we should catch
  excludedKeywords: string[]; // noise to skip (results, admit cards)
}

export interface MatchResult {
  verdict: "likely" | "possible" | "unlikely";
  score: number;
  reasons: string[];
}

const DEGREE_TERMS = ["b.tech", "b.e.", "b.e ", "btech", "bachelor of technology", "bachelor of engineering", "master", "m.tech", "m.e.", "graduat", "engineer"];

function haystack(title: string, summary: string | null): string {
  return `${title} ${summary ?? ""}`.toLowerCase();
}

// Deterministic match — no model, no guessing. A score with reasons the user
// can argue with, and an "unlikely" when the words simply do not line up.
export function matchEligibility(profile: UserProfile, title: string, summary: string | null): MatchResult {
  const text = haystack(title, summary);
  const reasons: string[] = [];
  let score = 0;

  if (profile.excludedKeywords.some((k) => text.includes(k.toLowerCase()))) {
    return { verdict: "unlikely", score: 0, reasons: ["looks like a result/admit-card notice, not an opening"] };
  }

  const fieldTerms = [profile.field, ...profile.extraKeywords].map((s) => s.toLowerCase());
  const fieldHit = fieldTerms.find((t) => t !== "" && text.includes(t));
  if (fieldHit !== undefined) {
    score += 40;
    reasons.push(`matches your field "${fieldHit}"`);
  }

  const degreeHit = DEGREE_TERMS.find((d) => text.includes(d));
  if (degreeHit !== undefined) {
    score += 20;
    reasons.push(`mentions qualification "${degreeHit.trim()}"`);
  }
  if (profile.qualifications.some((q) => text.includes(q.toLowerCase()))) {
    score += 20;
    reasons.push("mentions one of your qualifications");
  }

  if (profile.graduationYears && profile.graduationYears.length > 0) {
    const yearHit = profile.graduationYears.some((y) => text.includes(String(y)));
    if (yearHit) {
      score += 15;
      reasons.push("mentions an eligible graduation year");
    }
  }
  if (profile.ageLimit?.max !== undefined) {
    const ageHit = text.match(/(\d{2})\s*years?\s*old|age limit[^0-9]{0,12}(\d{2})/i);
    if (ageHit !== null) {
      const stated = Number(ageHit[1] ?? ageHit[2] ?? "0");
      if (stated > 0 && profile.ageLimit.max !== undefined && stated <= profile.ageLimit.max) {
        score += 15;
        reasons.push(`age limit ${stated} within your ${profile.ageLimit.max}`);
      } else if (stated > 0) {
        score -= 25;
        reasons.push(`age limit ${stated} may exceed your ${profile.ageLimit.max}`);
      }
    }
  }
  if (profile.categories.length > 0 && profile.categories.some((c) => text.includes(c.toLowerCase()))) {
    score += 10;
    reasons.push("mentions a reservation category you listed");
  }
  if (profile.states && profile.states.length > 0 && profile.states.some((s) => text.includes(s.toLowerCase()))) {
    score += 10;
    reasons.push("mentions a state you listed");
  }

  const verdict: MatchResult["verdict"] = score >= 50 ? "likely" : score >= 20 ? "possible" : "unlikely";
  if (reasons.length === 0) reasons.push("no field/qualification signal found in the text");
  return { verdict, score, reasons };
}

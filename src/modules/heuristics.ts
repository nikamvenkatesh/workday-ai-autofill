import { labelMatches, bestOptionMatch } from "../lib/fuzzy";
import type { FillPlan, FormField } from "../types/field";
import type { ResumeProfile, UserPreferences } from "../types/resume";
import { ACTIVE, candidatesFor } from "../config/target";

const EEO_PATTERNS = [
  "gender",
  "sex",
  "ethnicity",
  "race",
  "hispanic",
  "latino",
  "veteran",
  "disability",
  "lgbt",
  "sexual orientation",
  "decline to self",
  "voluntary",
  "eeo",
  "equal opportunity",
];

const SKIP_PATTERNS = [
  "password",
  "captcha",
  "verification code",
  "social security",
  "ssn",
  "national id",
  "passport number",
];

export function isEeoField(label: string): boolean {
  return labelMatches(label, EEO_PATTERNS);
}

export function shouldSkipField(field: FormField, preferences: UserPreferences): boolean {
  if (labelMatches(field.label, SKIP_PATTERNS)) return true;
  if (labelMatches(field.label, ["consent", "terms and conditions"])) return false;
  if (labelMatches(field.label, ["veteran"]) && field.required) return false;
  if (preferences.skipEEO && isEeoField(field.label) && !field.required) return true;
  if (field.type === "file") return true;
  return false;
}

export function heuristicMapField(
  field: FormField,
  profile: ResumeProfile,
  preferences: UserPreferences,
): FillPlan | null {
  const label = `${field.label} ${field.automationId ?? ""}`;

  if (labelMatches(label, ["preferred name"]) && field.type === "checkbox") {
    return {
      fieldId: field.id,
      label: field.label,
      value: false,
      confidence: "high",
      source: "skip",
      reason: "Leave preferred-name checkbox unchecked",
    };
  }

  if (shouldSkipField(field, preferences)) {
    return {
      fieldId: field.id,
      label: field.label,
      value: "",
      confidence: "low",
      source: "skip",
      reason: preferences.skipEEO && isEeoField(field.label)
        ? "Voluntary/EEO field skipped by preference"
        : "Sensitive or unsupported field skipped",
    };
  }

  const assign = (
    value: string | boolean,
    confidence: FillPlan["confidence"],
    source: FillPlan["source"],
    reason: string,
  ): FillPlan => ({
    fieldId: field.id,
    label: field.label,
    value,
    confidence,
    source,
    reason,
  });

  if (labelMatches(label, ["consent", "terms and conditions", "i consent"])) {
    return assign(true, "high", "preference", "Required terms consent");
  }
  if (labelMatches(label, ["veteran status", "protected veteran", "veteran"])) {
    return assign("I am not a protected veteran", "high", "inferred", "Required veteran status — not a veteran");
  }

  if (labelMatches(label, ["given name", "first name", "legal first", "preferred first"])) {
    return assign(profile.name.first, "high", "heuristic", "Mapped to resume first name");
  }
  if (labelMatches(label, ["family name", "last name", "surname", "legal last"])) {
    return assign(profile.name.last, "high", "heuristic", "Mapped to resume last name");
  }
  if (labelMatches(label, ["full name", "legal name"]) && !labelMatches(label, ["first", "last"])) {
    return assign(profile.name.full, "high", "heuristic", "Mapped to resume full name");
  }
  if (labelMatches(label, ["email"])) {
    return assign(profile.email, "high", "heuristic", "Mapped to resume email");
  }
  if (labelMatches(label, ["extension", "phone type", "device type", "phone device", "country phone", "phone code", "country code"])) {
    return {
      fieldId: field.id,
      label: field.label,
      value: "",
      confidence: "low",
      source: "skip",
      reason: "Phone metadata left for Workday defaults",
    };
  }
  if (/^(yes|no)$/i.test(field.label.trim())) {
    return {
      fieldId: field.id,
      label: field.label,
      value: "",
      confidence: "low",
      source: "skip",
      reason: "Yes/No radios are filled by the question helper",
    };
  }
  if (labelMatches(label, ["phone", "mobile", "cell"]) && !labelMatches(label, ["hear", "code", "type"])) {
    return assign(nationalPhone(profile.phone), "high", "heuristic", "Mapped to national phone number");
  }
  if (labelMatches(label, ["city"]) && profile.location.city) {
    return assign(profile.location.city, "high", "heuristic", "Mapped to resume city");
  }
  if (labelMatches(label, ["state", "province", "region"]) && profile.location.region) {
    return assign(selectOrRaw(field, profile.location.region), "medium", "heuristic", "Mapped to resume region");
  }
  if (
    labelMatches(label, ["country"]) &&
    !labelMatches(label, ["hear", "phone"]) &&
    (profile.location.country || preferences.countryOfResidence)
  ) {
    const country = profile.location.country || preferences.countryOfResidence || "";
    return assign(selectOrRaw(field, country), "medium", "heuristic", "Mapped to country");
  }
  if (labelMatches(label, ["postal", "zip"]) && profile.location.postal) {
    return assign(profile.location.postal, "high", "heuristic", "Mapped to postal code");
  }
  if (labelMatches(label, ["linkedin"]) && profile.links.linkedin) {
    return assign(profile.links.linkedin, "high", "heuristic", "Mapped to LinkedIn URL");
  }
  if (labelMatches(label, ["github"]) && profile.links.github) {
    return assign(profile.links.github, "high", "heuristic", "Mapped to GitHub URL");
  }
  if (labelMatches(label, ["website", "portfolio"]) && profile.links.website) {
    return assign(profile.links.website, "medium", "heuristic", "Mapped to website");
  }

  if (labelMatches(label, ["18", "over 18", "at least 18", "age of majority"])) {
    return yesNo(field, preferences.isOver18, "preference", "From user preference: over 18");
  }
  if (labelMatches(label, ["authorized to work", "work authorization", "legally authorized", "eligible to work", "legal right to work", "right to work"])) {
    return yesNo(field, preferences.authorizedToWork, "preference", "From user preference: work authorization");
  }
  if (labelMatches(label, ["sponsorship", "visa status", "require sponsorship", "future sponsorship"])) {
    return yesNo(field, preferences.requireSponsorship, "preference", "From user preference: sponsorship");
  }
  // Company-specific application questions are declared in src/config/target.ts
  // so that retargeting the extension never means editing the mapper.
  for (const rule of ACTIVE.questions) {
    if (!labelMatches(label, rule.labels)) continue;
    const candidates = candidatesFor(rule, preferences);

    // Prefer a candidate that actually exists in the live dropdown.
    if (field.options?.length) {
      for (const candidate of candidates) {
        const option = bestOptionMatch(candidate, field.options);
        if (option) {
          return {
            fieldId: field.id,
            label: field.label,
            value: option,
            confidence: rule.confidence,
            source: rule.source,
            reason: rule.reason,
          };
        }
      }
      // Nothing matched: surface it for review rather than guessing.
      return {
        fieldId: field.id,
        label: field.label,
        value: "",
        confidence: "low",
        source: "skip",
        reason: `No option matched ${rule.id} - answer this one manually`,
      };
    }

    const first = candidates[0] ?? "";
    if (field.type === "checkbox") {
      return yesNo(field, /^yes$/i.test(first), rule.source, rule.reason);
    }
    return {
      fieldId: field.id,
      label: field.label,
      value: first,
      confidence: rule.confidence,
      source: rule.source,
      reason: rule.reason,
    };
  }
  if (labelMatches(label, ["notice period", "availability to start"])) {
    const when = new Date();
    when.setDate(when.getDate() + 14);
    const digits = `${String(when.getMonth() + 1).padStart(2, "0")}${String(when.getDate()).padStart(2, "0")}${when.getFullYear()}`;
    return assign(digits, "high", "inferred", "Notice period defaulted to 2 weeks (typed as MMDDYYYY)");
  }
  if (labelMatches(label, ["relocate", "willing to relocate"]) && preferences.willingToRelocate !== undefined) {
    return yesNo(field, Boolean(preferences.willingToRelocate), "preference", "From user preference: relocate");
  }

  const exp = profile.experience[0];
  if (exp) {
    if (labelMatches(label, ["job title", "position title", "most recent title"]) && !labelMatches(label, ["previous"])) {
      return assign(exp.title, "medium", "heuristic", "Mapped to latest job title");
    }
    if (labelMatches(label, ["company", "employer", "organization"]) && !labelMatches(label, ["school"])) {
      return assign(exp.company, "medium", "heuristic", "Mapped to latest employer");
    }
  }

  const edu = profile.education[0];
  if (edu) {
    if (labelMatches(label, ["school", "university", "college", "institution"])) {
      return assign(edu.school, "medium", "heuristic", "Mapped to latest school");
    }
    if (labelMatches(label, ["degree"]) && edu.degree) {
      return assign(selectOrRaw(field, edu.degree), "medium", "heuristic", "Mapped to degree");
    }
    if (labelMatches(label, ["field of study", "major"]) && edu.field) {
      return assign(edu.field, "medium", "heuristic", "Mapped to field of study");
    }
  }

  // "How did you hear about us?" is a two-level Workday prompt: a category is
  // clicked, then a child. A single value written into the input never commits,
  // so we hand it to the in-page DOM pass (workdayFixes.fillHowDidYouHear)
  // rather than producing a plan the filler cannot honour.
  if (labelMatches(label, ["how did you hear", "hear about us"])) {
    return {
      fieldId: field.id,
      label: field.label,
      value: "",
      confidence: "low",
      source: "skip",
      reason: "Two-level prompt - handled by the in-page pass",
    };
  }

  return null;
}

function nationalPhone(phone: string): string {
  let digits = phone.replace(/[^\d]/g, "");
  if (digits.startsWith("91") && digits.length >= 12) digits = digits.slice(2);
  if (digits.startsWith("1") && digits.length === 11) digits = digits.slice(1);
  return digits || phone;
}

function selectOrRaw(field: FormField, value: string): string {
  if (field.options?.length) {
    return bestOptionMatch(value, field.options) ?? value;
  }
  return value;
}

function yesNo(
  field: FormField,
  answer: boolean,
  source: FillPlan["source"],
  reason: string,
): FillPlan {
  let value: string | boolean = answer;
  if (field.type === "checkbox") value = answer;
  else if (field.options?.length) {
    const yes = bestOptionMatch(answer ? "yes" : "no", field.options);
    value = yes ?? (answer ? "Yes" : "No");
  } else {
    value = answer ? "Yes" : "No";
  }
  return {
    fieldId: field.id,
    label: field.label,
    value,
    confidence: "high",
    source,
    reason,
  };
}

export function mergePlans(heuristic: FillPlan[], ai: FillPlan[]): FillPlan[] {
  const byId = new Map<string, FillPlan>();
  for (const plan of heuristic) byId.set(plan.fieldId, plan);
  for (const plan of ai) {
    const existing = byId.get(plan.fieldId);
    if (!existing || existing.source === "skip") {
      if (existing?.source === "skip") continue;
      byId.set(plan.fieldId, plan);
      continue;
    }
    if (existing.confidence === "high") continue;
    if (plan.confidence === "high" || plan.confidence === "medium") {
      byId.set(plan.fieldId, plan);
    }
  }
  return [...byId.values()];
}

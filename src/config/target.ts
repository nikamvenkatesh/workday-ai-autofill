import type { UserPreferences } from "../types/resume";
import type { FillPlan } from "../types/field";

/**
 * Single source of truth for everything specific to the Workday posting this
 * build targets.
 *
 * The rest of the extension (parser, detector, filler, navigator, mapper) is
 * company-agnostic. Anything that knows a company name, the wording of one of
 * its application questions, or the options in one of its dropdowns belongs in
 * this file and nowhere else.
 *
 * To retarget, change `ACTIVE` at the bottom. No other file needs to be touched.
 */

/**
 * How to answer one company-specific application question.
 *
 * `answer` is a *preference-ordered list of candidate values*, not a single
 * string. The filler tries each against the live dropdown options and takes the
 * first that fuzzy-matches. This is what makes the same rule work when one
 * posting offers "No" and another offers "No, but willing to learn".
 */
export type QuestionRule = {
  /** Stable id, used in logs and the review panel. */
  id: string;
  /** Label fragments for the heuristic mapper (lower-case, matched loosely). */
  labels: string[];
  /** Same question as a RegExp, for the in-page DOM pass. */
  match: RegExp;
  /** Candidate answers, best first. Either fixed or derived from preferences. */
  answer: string[] | ((prefs: UserPreferences) => string[]);
  source: FillPlan["source"];
  /**
   * Anything below "high" is surfaced in the review panel rather than trusted
   * silently. Use "medium" for defensible defaults the user should eyeball.
   */
  confidence: FillPlan["confidence"];
  /** Human-readable justification, shown before submit. */
  reason: string;
};

export type TargetConfig = {
  company: string;
  jobTitle: string;
  jobId: string;
  jobUrl: string;
  tenantHost: string;
  /**
   * "How did you hear about us?" is a two-level Workday prompt: a category must
   * be clicked, then a child. Selecting only the category leaves it invalid.
   */
  sourceCategories: string[];
  sourceLeaves: string[];
  questions: QuestionRule[];
};

/* ------------------------------------------------------------------ */
/* Shared Target questions                                             */
/* ------------------------------------------------------------------ */
/* Note: "at least 18", "legally authorized" and "sponsorship" are already
   handled generically in heuristics.ts from saved user preferences, so they
   are deliberately not repeated here. */

const RETAIL_EXPERIENCE_FALLBACK = ["No, but willing to learn", "No"];

const TARGET_COMMON_QUESTIONS: QuestionRule[] = [
  {
    id: "previously-worked",
    labels: ["previously worked for target", "previously worked", "previously employed", "former team member"],
    match: /previously worked for target|previously worked|previously employed/i,
    answer: ["No"],
    source: "preference",
    confidence: "high",
    reason: "Defaulted to not previously employed by this company",
  },
  {
    id: "employment-restrictions",
    labels: ["employment agreement", "non-compete", "non-solicitation", "confidentiality agreement", "restrictions with your current"],
    match: /employment agreement|non-compete|non-solicitation|confidentiality agreement/i,
    answer: ["No"],
    source: "inferred",
    confidence: "medium",
    reason: "Defaulted to no restrictive covenant - verify before submitting",
  },
  {
    id: "contractor-past-12-months",
    labels: ["contractor with target", "been a contractor"],
    match: /contractor with target|been a contractor/i,
    answer: ["No"],
    source: "inferred",
    confidence: "high",
    reason: "Defaulted to not a recent contractor",
  },
  {
    id: "agency-referral",
    labels: ["referred by a community workforce", "staffing agency"],
    match: /community workforce|staffing agency/i,
    answer: ["No"],
    source: "inferred",
    confidence: "high",
    reason: "Defaulted to no agency referral",
  },

  /* Retail experience matrix - a software CV cannot evidence these, so we
     answer honestly rather than inflating, at medium confidence. */
  {
    id: "experience-beauty",
    labels: ["experience in beauty", "skin care", "hair care"],
    match: /experience in beauty/i,
    answer: RETAIL_EXPERIENCE_FALLBACK,
    source: "inferred",
    confidence: "medium",
    reason: "No beauty retail experience evidenced in the resume",
  },
  {
    id: "experience-tech",
    labels: ["experience in tech", "electronics"],
    match: /experience in tech|electronics/i,
    answer: ["Yes - 1-3 years", "Yes - Under 1 year", ...RETAIL_EXPERIENCE_FALLBACK],
    source: "resume",
    confidence: "medium",
    reason: "Resume evidences technology experience",
  },
  {
    id: "experience-style",
    labels: ["experience in style", "apparel", "accessories"],
    match: /experience in style|apparel/i,
    answer: RETAIL_EXPERIENCE_FALLBACK,
    source: "inferred",
    confidence: "medium",
    reason: "No apparel retail experience evidenced in the resume",
  },
  {
    id: "experience-food",
    labels: ["experience in food", "grocery", "food prep", "food service"],
    match: /experience in food|grocery|food prep/i,
    answer: RETAIL_EXPERIENCE_FALLBACK,
    source: "inferred",
    confidence: "medium",
    reason: "No food service experience evidenced in the resume",
  },
  {
    id: "experience-salesfloor",
    labels: ["retail salesfloor", "salesfloor"],
    match: /retail salesfloor|salesfloor/i,
    answer: RETAIL_EXPERIENCE_FALLBACK,
    source: "inferred",
    confidence: "medium",
    reason: "No salesfloor experience evidenced in the resume",
  },
  {
    id: "experience-warehousing",
    labels: ["experience in warehousing", "unloading trucks", "packing orders"],
    match: /warehousing|unloading trucks/i,
    answer: RETAIL_EXPERIENCE_FALLBACK,
    source: "inferred",
    confidence: "medium",
    reason: "No warehousing experience evidenced in the resume",
  },
  {
    id: "experience-guest-service",
    labels: ["guest/customer service", "guest service", "customer service"],
    match: /guest\/customer service|guest service|customer service/i,
    answer: ["Yes - 1-3 years", "Yes - Under 1 year", ...RETAIL_EXPERIENCE_FALLBACK],
    source: "inferred",
    confidence: "medium",
    reason: "Client-facing experience is evidenced, but not in a retail setting",
  },

  /* Availability block - one rule matches all seven weekday questions. */
  {
    id: "weekend-availability",
    labels: ["primarily available to work on weekends", "weekends and holidays"],
    match: /primarily available to work on weekends|weekends and holidays/i,
    answer: ["Yes"],
    source: "preference",
    confidence: "medium",
    reason: "Defaulted to available on weekends - change if untrue",
  },
  {
    id: "earliest-start-time",
    labels: ["earliest time you can work"],
    match: /earliest time you can work/i,
    answer: ["6:00 AM", "6 AM", "7:00 AM", "8:00 AM", "Anytime"],
    source: "preference",
    confidence: "medium",
    reason: "Defaulted to an early general availability",
  },
  {
    id: "sms-consent",
    labels: ["permission to contact you via text", "text message", "message & data rates"],
    match: /permission to contact you via text|message & data rates/i,
    answer: ["No"],
    source: "preference",
    confidence: "medium",
    reason: "Marketing SMS consent defaulted to No - opt in manually if wanted",
  },

  /* Voluntary disclosures. Required on this tenant, so they cannot simply be
     skipped - we decline to self-identify rather than invent demographics. */
  {
    id: "eeo-gender",
    labels: ["select your gender", "gender"],
    match: /select your gender/i,
    answer: ["I do not wish to answer", "Decline to self-identify", "Decline to self identify", "Do not wish to disclose"],
    source: "preference",
    confidence: "medium",
    reason: "Declined to self-identify (voluntary disclosure)",
  },
  {
    id: "eeo-race",
    labels: ["race: select the option", "race"],
    match: /race: select the option|^race/i,
    answer: ["I do not wish to answer", "Decline to self-identify", "Decline to self identify", "Do not wish to disclose"],
    source: "preference",
    confidence: "medium",
    reason: "Declined to self-identify (voluntary disclosure)",
  },
  {
    id: "eeo-hispanic",
    labels: ["hispanic or latino"],
    match: /hispanic or latino/i,
    answer: ["I do not wish to answer", "Decline to self-identify", "No"],
    source: "preference",
    confidence: "medium",
    reason: "Declined to self-identify (voluntary disclosure)",
  },
];

/* Leadership questions appear only on team-leader postings. */
const TARGET_LEADERSHIP_QUESTIONS: QuestionRule[] = [
  {
    id: "years-leading-team",
    labels: ["years of experience do you have leading a team"],
    match: /years of experience do you have leading a team/i,
    answer: ["Yes - Under 1 year", "Under 1 year", "No"],
    source: "resume",
    confidence: "low",
    reason: "Limited formal people-leadership evidenced - review this answer",
  },
  {
    id: "years-leading-retail-teams",
    labels: ["leading teams who are stocking", "stocking, setting and selling"],
    match: /leading teams who are stocking/i,
    answer: ["No"],
    source: "inferred",
    confidence: "medium",
    reason: "No retail merchandising leadership evidenced in the resume",
  },
  {
    id: "team-size-led",
    labels: ["size of the teams you have led"],
    match: /size of the teams you have led/i,
    answer: ["1-5", "Under 5", "1 - 5"],
    source: "inferred",
    confidence: "low",
    reason: "Smallest bracket chosen as the conservative default - review",
  },
  {
    id: "years-coaching",
    labels: ["coaching and developing your teams"],
    match: /coaching and developing your teams/i,
    answer: ["Yes - Under 1 year", "Under 1 year", "No"],
    source: "inferred",
    confidence: "low",
    reason: "Limited formal coaching experience evidenced - review",
  },
  {
    id: "years-hiring",
    labels: ["hiring and building sales focused teams"],
    match: /hiring and building sales focused teams/i,
    answer: ["No"],
    source: "inferred",
    confidence: "medium",
    reason: "No hiring experience evidenced in the resume",
  },
];

/* ------------------------------------------------------------------ */
/* Postings                                                            */
/* ------------------------------------------------------------------ */

const TARGET_SOURCE_CATEGORIES = ["Job Boards", "Social Media", "Corporate Website"];
const TARGET_SOURCE_LEAVES = ["LinkedIn", "Indeed", "Glassdoor", "Other"];

/**
 * Entry-level hourly posting. Fewer application questions, BUT the flow adds a
 * "Take Assessment" step between Voluntary Disclosures and Review, which gates
 * the submit step behind a test the extension cannot complete. Not selected.
 */
const TARGET_DELI: TargetConfig = {
  company: "Target",
  jobTitle: "Deli Production Expert",
  jobId: "R0000475043",
  jobUrl:
    "https://target.wd5.myworkdayjobs.com/en-US/targetcareers/details/Deli-Production-Expert_R0000475043",
  tenantHost: "target.wd5.myworkdayjobs.com",
  sourceCategories: TARGET_SOURCE_CATEGORIES,
  sourceLeaves: TARGET_SOURCE_LEAVES,
  questions: TARGET_COMMON_QUESTIONS,
};

/**
 * SELECTED POSTING. Five steps, no assessment gate, so the automation can run
 * cleanly through to Review and submit. Costs ~5 extra leadership questions,
 * which are declared above and cheap to answer.
 */
const TARGET_TEAM_LEADER: TargetConfig = {
  company: "Target",
  jobTitle: "Specialty Sales Team Leader - Fitchburg, WI",
  jobId: "R0000475137",
  jobUrl:
    "https://target.wd5.myworkdayjobs.com/en-US/targetcareers/job/6321-McKee-Rd%2C-Fitchburg%2CWI-53719-5017/Specialty-Sales-Team-Leader---Fitchburg--WI_R0000475137/apply/applyManually",
  tenantHost: "target.wd5.myworkdayjobs.com",
  sourceCategories: TARGET_SOURCE_CATEGORIES,
  sourceLeaves: TARGET_SOURCE_LEAVES,
  questions: [...TARGET_COMMON_QUESTIONS, ...TARGET_LEADERSHIP_QUESTIONS],
};

/** Change this one line to retarget the extension. */
export const ACTIVE: TargetConfig = TARGET_TEAM_LEADER;

export const AVAILABLE_TARGETS: TargetConfig[] = [TARGET_DELI, TARGET_TEAM_LEADER];

/** Resolve a rule's candidate answers against the user's saved preferences. */
export function candidatesFor(rule: QuestionRule, prefs: UserPreferences): string[] {
  return typeof rule.answer === "function" ? rule.answer(prefs) : rule.answer;
}

/** Short label for the popup, e.g. "Target - Deli Production Expert". */
export function targetLabel(config: TargetConfig = ACTIVE): string {
  return `${config.company} - ${config.jobTitle}`;
}

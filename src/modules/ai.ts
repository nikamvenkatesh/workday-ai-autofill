import type { FillPlan, FormField } from "../types/field";
import type { ResumeProfile, UserPreferences } from "../types/resume";
import { heuristicParse } from "./textParse";

const PARSE_SYSTEM = `You convert resume text into strict JSON for job-application autofill.
Return ONLY JSON with this shape:
{
  "name": { "first": "", "last": "", "full": "" },
  "email": "",
  "phone": "",
  "location": { "city": "", "region": "", "country": "", "postal": "" },
  "links": { "linkedin": "", "github": "", "website": "" },
  "summary": "",
  "experience": [{ "title": "", "company": "", "start": "", "end": "", "location": "", "bullets": [] }],
  "education": [{ "school": "", "degree": "", "field": "", "start": "", "end": "", "gpa": "" }],
  "skills": [],
  "certifications": []
}
Rules:
- Do not invent employers, schools, dates, or contact details.
- Dates as YYYY-MM or "present".
- Infer country/city only if clearly stated.
- Empty string or [] when unknown.`;

const MAP_SYSTEM = `You map a candidate profile onto Workday form fields.
Return ONLY JSON: { "plans": [ { "fieldId": "", "label": "", "value": "", "confidence": "high|medium|low", "source": "resume|inferred|skip", "reason": "" } ] }
Rules:
- Use fieldId values exactly as provided.
- For select/radio, value MUST be one of the provided options (or skip).
- Skip EEO/demographic/voluntary identity questions unless preferences clearly answer them.
- Skip anything you cannot answer from resume or preferences. Do not invent visa, salary, or criminal-history answers.
- Do not overwrite a non-empty currentValue unless the mapped value is clearly better.
- Boolean checkboxes as true/false.
- Keep values short and form-appropriate.`;

export async function aiParseResume(apiKey: string, text: string): Promise<ResumeProfile> {
  const fallback = heuristicParse(text);
  if (!apiKey) return fallback;

  const raw = await chatJson(apiKey, "gpt-4o-mini", [
    { role: "system", content: PARSE_SYSTEM },
    { role: "user", content: text.slice(0, 18000) },
  ]);
  return normalizeProfile(raw, fallback);
}

export async function aiMapFields(
  apiKey: string,
  profile: ResumeProfile,
  preferences: UserPreferences,
  fields: FormField[],
): Promise<FillPlan[]> {
  if (!apiKey || !fields.length) return [];

  const payload = {
    preferences,
    profile,
    fields: fields.map((f) => ({
      id: f.id,
      label: f.label,
      type: f.type,
      required: f.required,
      options: f.options?.slice(0, 40),
      currentValue: f.currentValue || "",
      section: f.section || "",
    })),
  };

  const raw = await chatJson(apiKey, "gpt-4o", [
    { role: "system", content: MAP_SYSTEM },
    { role: "user", content: JSON.stringify(payload) },
  ]);

  const plans = Array.isArray(raw.plans) ? raw.plans : [];
  return plans
    .filter((p: Record<string, unknown>) => typeof p.fieldId === "string")
    .map((p: Record<string, unknown>) => ({
      fieldId: String(p.fieldId),
      label: String(p.label ?? ""),
      value: (p.value as FillPlan["value"]) ?? "",
      confidence: (["high", "medium", "low"].includes(String(p.confidence))
        ? p.confidence
        : "low") as FillPlan["confidence"],
      source: (["resume", "inferred", "preference", "heuristic", "skip"].includes(String(p.source))
        ? p.source
        : "inferred") as FillPlan["source"],
      reason: String(p.reason ?? "AI mapping"),
    }));
}

async function chatJson(
  apiKey: string,
  model: string,
  messages: { role: string; content: string }[],
): Promise<Record<string, unknown>> {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.1,
      response_format: { type: "json_object" },
      messages,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI error ${response.status}: ${err.slice(0, 240)}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenAI returned an empty response");
  return JSON.parse(content) as Record<string, unknown>;
}

function normalizeProfile(raw: Record<string, unknown>, fallback: ResumeProfile): ResumeProfile {
  const name = (raw.name as Record<string, string> | undefined) ?? {};
  const location = (raw.location as Record<string, string> | undefined) ?? {};
  const links = (raw.links as Record<string, string> | undefined) ?? {};
  return {
    name: {
      first: name.first || fallback.name.first,
      last: name.last || fallback.name.last,
      full: name.full || fallback.name.full,
    },
    email: String(raw.email || fallback.email),
    phone: String(raw.phone || fallback.phone),
    location: {
      city: location.city || fallback.location.city,
      region: location.region || fallback.location.region,
      country: location.country || fallback.location.country,
      postal: location.postal || fallback.location.postal,
    },
    links: {
      linkedin: links.linkedin || fallback.links.linkedin,
      github: links.github || fallback.links.github,
      website: links.website || fallback.links.website,
    },
    summary: String(raw.summary || fallback.summary || ""),
    experience: Array.isArray(raw.experience) && raw.experience.length
      ? (raw.experience as ResumeProfile["experience"])
      : fallback.experience,
    education: Array.isArray(raw.education) && raw.education.length
      ? (raw.education as ResumeProfile["education"])
      : fallback.education,
    skills: Array.isArray(raw.skills) && raw.skills.length
      ? (raw.skills as string[])
      : fallback.skills,
    certifications: Array.isArray(raw.certifications) && raw.certifications.length
      ? (raw.certifications as string[])
      : fallback.certifications,
  };
}

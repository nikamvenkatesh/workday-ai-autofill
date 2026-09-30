import { EMPTY_PROFILE, type ResumeProfile } from "../types/resume";

export function heuristicParse(text: string): ResumeProfile {
  const profile: ResumeProfile = structuredClone(EMPTY_PROFILE);
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] ?? "";
  const phone =
    text.match(/(\+?\d{1,3}[\s.-]?)?(\(?\d{3}\)?[\s.-]?)\d{3}[\s.-]?\d{4}/)?.[0] ?? "";
  const linkedin = text.match(/https?:\/\/(?:www\.)?linkedin\.com\/[^\s)]+/i)?.[0];
  const github = text.match(/https?:\/\/(?:www\.)?github\.com\/[^\s)]+/i)?.[0];
  const website = text.match(/https?:\/\/(?!www\.(?:linkedin|github)\.com)[^\s)]+/i)?.[0];

  const firstLine = text.split(/[\n\r]+/).map((l) => l.trim()).find(Boolean) ?? "";
  const maybeName = firstLine.replace(email, "").replace(phone, "").trim();
  const nameParts = maybeName.split(/\s+/).filter((p) => /^[A-Za-z.'-]+$/.test(p));
  const first = nameParts[0] ?? "";
  const last = nameParts.slice(1).join(" ");

  profile.email = email;
  profile.phone = phone;
  profile.name = { first, last, full: [first, last].filter(Boolean).join(" ") };
  profile.links = {
    linkedin: linkedin?.replace(/[.,;]+$/, ""),
    github: github?.replace(/[.,;]+$/, ""),
    website: website?.replace(/[.,;]+$/, ""),
  };

  const skillsBlock = text.match(/skills[:\s]+(.{20,400})/i)?.[1];
  if (skillsBlock) {
    profile.skills = skillsBlock
      .split(/[,•|]/)
      .map((s) => s.trim())
      .filter((s) => s.length > 1 && s.length < 40)
      .slice(0, 30);
  }

  return profile;
}

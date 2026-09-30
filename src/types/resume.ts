export type ExperienceItem = {
  title: string;
  company: string;
  start: string;
  end: string | "present";
  location?: string;
  bullets: string[];
};

export type EducationItem = {
  school: string;
  degree?: string;
  field?: string;
  start?: string;
  end?: string;
  gpa?: string;
};

export type ResumeProfile = {
  name: { first: string; last: string; full: string };
  email: string;
  phone: string;
  location: { city?: string; region?: string; country?: string; postal?: string };
  links: { linkedin?: string; github?: string; website?: string };
  summary?: string;
  experience: ExperienceItem[];
  education: EducationItem[];
  skills: string[];
  certifications: string[];
};

export type UserPreferences = {
  isOver18: boolean;
  authorizedToWork: boolean;
  requireSponsorship: boolean;
  skipEEO: boolean;
  willingToRelocate?: boolean;
  countryOfResidence?: string;
};

export const DEFAULT_PREFERENCES: UserPreferences = {
  isOver18: true,
  authorizedToWork: true,
  requireSponsorship: false,
  skipEEO: true,
  willingToRelocate: false,
};

export const EMPTY_PROFILE: ResumeProfile = {
  name: { first: "", last: "", full: "" },
  email: "",
  phone: "",
  location: {},
  links: {},
  experience: [],
  education: [],
  skills: [],
  certifications: [],
};

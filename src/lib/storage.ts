import { DEFAULT_PREFERENCES, type ResumeProfile, type UserPreferences } from "../types/resume";

const KEYS = {
  apiKey: "wdaf_openai_key",
  profile: "wdaf_profile",
  preferences: "wdaf_preferences",
  resumeFile: "wdaf_resume_file",
} as const;

export type StoredResumeFile = {
  name: string;
  mimeType: string;
  base64: string;
};

export async function getApiKey(): Promise<string> {
  const data = await chrome.storage.local.get(KEYS.apiKey);
  return String(data[KEYS.apiKey] ?? "");
}

export async function setApiKey(key: string): Promise<void> {
  await chrome.storage.local.set({ [KEYS.apiKey]: key.trim() });
}

export async function getProfile(): Promise<ResumeProfile | null> {
  const data = await chrome.storage.session.get(KEYS.profile);
  return (data[KEYS.profile] as ResumeProfile | undefined) ?? null;
}

export async function setProfile(profile: ResumeProfile): Promise<void> {
  await chrome.storage.session.set({ [KEYS.profile]: profile });
}

export async function clearProfile(): Promise<void> {
  await chrome.storage.session.remove(KEYS.profile);
}

export async function getPreferences(): Promise<UserPreferences> {
  const data = await chrome.storage.local.get(KEYS.preferences);
  return {
    ...DEFAULT_PREFERENCES,
    ...(data[KEYS.preferences] as UserPreferences | undefined),
  };
}

export async function setPreferences(preferences: UserPreferences): Promise<void> {
  await chrome.storage.local.set({ [KEYS.preferences]: preferences });
}

export async function setResumeFile(file: StoredResumeFile): Promise<void> {
  await chrome.storage.session.set({ [KEYS.resumeFile]: file });
}

export async function getResumeFile(): Promise<StoredResumeFile | null> {
  const data = await chrome.storage.session.get(KEYS.resumeFile);
  return (data[KEYS.resumeFile] as StoredResumeFile | undefined) ?? null;
}

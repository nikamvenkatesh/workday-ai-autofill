import { DEFAULT_PREFERENCES, type ResumeProfile, type UserPreferences } from "../types/resume";
import type { AutofillPhase, LogEntry, ReviewSummary, SessionState } from "../types/field";
import { ACTIVE } from "../config/target";

const SELECTED_COMPANY = ACTIVE.company;
const SELECTED_JOB = `${ACTIVE.jobTitle} (${ACTIVE.jobId})`;

let state: SessionState = {
  phase: "idle",
  selectedCompany: SELECTED_COMPANY,
  selectedJob: SELECTED_JOB,
  profile: null,
  preferences: DEFAULT_PREFERENCES,
  currentStep: "",
  logs: [],
  lastReview: null,
  lastError: null,
  hasApiKey: false,
};

const listeners = new Set<(next: SessionState) => void>();

export function getState(): SessionState {
  return structuredClone(state);
}

export function subscribe(fn: (next: SessionState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  const snapshot = getState();
  for (const fn of listeners) fn(snapshot);
  void chrome.runtime.sendMessage({ type: "STATE", state: snapshot }).catch(() => undefined);
}

export function patch(partial: Partial<SessionState>) {
  state = { ...state, ...partial };
  emit();
}

export function log(level: LogEntry["level"], message: string) {
  const entry: LogEntry = { at: Date.now(), level, message };
  state = { ...state, logs: [...state.logs.slice(-80), entry] };
  emit();
}

export function setPhase(phase: AutofillPhase, extra: Partial<SessionState> = {}) {
  patch({ phase, ...extra });
}

export function setProfile(profile: ResumeProfile) {
  patch({ profile, phase: "ready", lastError: null });
}

export function setPreferences(preferences: UserPreferences) {
  patch({ preferences });
}

export function setHasApiKey(hasApiKey: boolean) {
  patch({ hasApiKey });
}

export function setReview(lastReview: ReviewSummary) {
  patch({ lastReview });
}

export function resetSession(keepProfile = true) {
  state = {
    ...state,
    phase: keepProfile && state.profile ? "ready" : "idle",
    currentStep: "",
    logs: [],
    lastReview: null,
    lastError: null,
    profile: keepProfile ? state.profile : null,
  };
  emit();
}

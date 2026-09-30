export type FieldType =
  | "text"
  | "textarea"
  | "select"
  | "date"
  | "radio"
  | "checkbox"
  | "file"
  | "unknown";

export type FormField = {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  currentValue?: string;
  section?: string;
  automationId?: string;
};

export type FillPlan = {
  fieldId: string;
  label: string;
  value: string | string[] | boolean;
  confidence: "high" | "medium" | "low";
  source: "resume" | "inferred" | "preference" | "heuristic" | "skip";
  reason: string;
};

export type FillResult = {
  fieldId: string;
  label: string;
  ok: boolean;
  value?: string;
  error?: string;
};

export type ReviewSummary = {
  stepName: string;
  filled: FillResult[];
  skipped: FillPlan[];
  errors: string[];
};

export type AutofillPhase =
  | "idle"
  | "parsing"
  | "ready"
  | "waiting_login"
  | "filling"
  | "review"
  | "submitting"
  | "submitted"
  | "error";

export type LogEntry = {
  at: number;
  level: "info" | "warn" | "error";
  message: string;
};

export type SessionState = {
  phase: AutofillPhase;
  selectedCompany: string;
  selectedJob: string;
  profile: import("./resume").ResumeProfile | null;
  preferences: import("./resume").UserPreferences;
  currentStep: string;
  logs: LogEntry[];
  lastReview: ReviewSummary | null;
  lastError: string | null;
  hasApiKey: boolean;
};

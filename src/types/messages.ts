import type { FillPlan, FormField, ReviewSummary } from "./field";
import type { ResumeProfile, UserPreferences } from "./resume";

export type RuntimeMessage =
  | { type: "GET_STATE" }
  | { type: "SAVE_API_KEY"; key: string }
  | { type: "SAVE_PREFERENCES"; preferences: UserPreferences }
  | { type: "PARSE_RESUME_TEXT"; text: string; fileName: string; fileBase64?: string; mimeType?: string }
  | { type: "GET_RESUME_FILE" }
  | { type: "UPDATE_PROFILE"; profile: ResumeProfile }
  | { type: "START_AUTOFILL" }
  | { type: "PAUSE_AUTOFILL" }
  | { type: "CONFIRM_SUBMIT" }
  | { type: "RESET" }
  | { type: "CONTENT_READY"; url: string; title: string }
  | { type: "LOGIN_REQUIRED" }
  | { type: "STEP_DETECTED"; stepName: string; url: string }
  | { type: "FIELDS_DETECTED"; stepName: string; fields: FormField[] }
  | { type: "FILL_DONE"; stepName: string; review: ReviewSummary }
  | { type: "NAVIGATION_DONE"; stepName: string }
  | { type: "VALIDATION_ERRORS"; messages: string[] }
  | { type: "CONTENT_ERROR"; message: string }
  | { type: "SUBMIT_DONE" }
  | { type: "APPLY_FILL_PLAN"; plan: FillPlan[]; stepName: string }
  | { type: "CLICK_NEXT" }
  | { type: "CLICK_SUBMIT" }
  | { type: "SCAN_FIELDS" };

export type StateBroadcast = { type: "STATE"; state: import("./field").SessionState };

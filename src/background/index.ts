import type { RuntimeMessage } from "../types/messages";
import type { FillPlan, FormField, ReviewSummary } from "../types/field";
import { aiParseResume } from "../modules/ai";
import { mapFields } from "../modules/mapper";
import * as store from "../lib/storage";
import * as session from "./state";

import { ACTIVE } from "../config/target";
chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false });
});

void bootstrap();

async function bootstrap() {
  const [key, profile, preferences] = await Promise.all([
    store.getApiKey(),
    store.getProfile(),
    store.getPreferences(),
  ]);
  session.setHasApiKey(Boolean(key));
  session.setPreferences(preferences);
  if (profile) session.setProfile(profile);
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, sender, sendResponse) => {
  void handle(message, sender)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: Error) => {
      session.log("error", error.message);
      session.setPhase("error", { lastError: error.message });
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

async function handle(message: RuntimeMessage, sender: chrome.runtime.MessageSender) {
  switch (message.type) {
    case "GET_STATE":
      return session.getState();
    case "SAVE_API_KEY":
      await store.setApiKey(message.key);
      session.setHasApiKey(Boolean(message.key.trim()));
      session.log("info", message.key.trim() ? "API key saved locally." : "API key cleared.");
      return true;
    case "SAVE_PREFERENCES":
      await store.setPreferences(message.preferences);
      session.setPreferences(message.preferences);
      return true;
    case "PARSE_RESUME_TEXT": {
      session.setPhase("parsing", { lastError: null });
      session.log("info", `Parsing ${message.fileName}…`);
      const key = await store.getApiKey();
      const profile = await aiParseResume(key, message.text);
      await store.setProfile(profile);
      session.setProfile(profile);
      if (message.fileBase64) {
        await store.setResumeFile({
          name: message.fileName,
          mimeType: message.mimeType || "application/pdf",
          base64: message.fileBase64,
        });
      }
      session.log("info", key ? "Resume parsed with AI." : "Resume parsed with heuristics (no API key).");
      return profile;
    }
    case "GET_RESUME_FILE":
      return store.getResumeFile();
    case "UPDATE_PROFILE":
      await store.setProfile(message.profile);
      session.setProfile(message.profile);
      return true;
    case "START_AUTOFILL":
      return startAutofill();
    case "PAUSE_AUTOFILL":
      session.setPhase("ready");
      session.log("warn", "Autofill paused.");
      return true;
    case "CONFIRM_SUBMIT":
      session.setPhase("submitting");
      session.log("info", "User confirmed submit.");
      await sendToActiveTab({ type: "CLICK_SUBMIT" });
      return true;
    case "RESET":
      session.resetSession(true);
      return true;
    case "CONTENT_READY":
      session.log("info", `Workday page ready: ${message.title || message.url}`);
      return true;
    case "LOGIN_REQUIRED":
      session.setPhase("waiting_login");
      session.log("warn", "Sign-in required. Log in manually, then click Start Autofill again.");
      return true;
    case "STEP_DETECTED":
      session.patch({ currentStep: message.stepName });
      session.log("info", `Step: ${message.stepName}`);
      return true;
    case "FIELDS_DETECTED":
      return onFieldsDetected(message.stepName, message.fields, sender.tab?.id);
    case "FILL_DONE":
      return onFillDone(message.review);
    case "VALIDATION_ERRORS":
      session.log("warn", `Validation: ${message.messages.join("; ")}`);
      return true;
    case "CONTENT_ERROR":
      session.log("error", message.message);
      return true;
    case "SUBMIT_DONE":
      session.setPhase("submitted");
      session.log("info", "Submit clicked after user confirmation.");
      return true;
    default:
      return null;
  }
}

async function startAutofill() {
  const state = session.getState();
  if (!state.profile) throw new Error("Upload and parse a resume first.");

  const tab = await getWorkdayTab();
  if (!tab?.id) {
    throw new Error(
      `No Workday tab found. Keep the ${ACTIVE.company} Apply tab focused, then click Start autofill again.`,
    );
  }

  try {
    if (tab.windowId != null) await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    session.log("warn", "Side panel did not open automatically. Autofill will still run.");
  }

  session.setPhase("filling", { lastReview: null, lastError: null });
  session.log("info", `Starting autofill on ${tab.url ?? "Workday tab"}.`);
  await sendScan(tab.id);

  await sleep(4000);
  const after = session.getState();
  if (after.phase === "waiting_login") {
    throw new Error("Workday wants you to sign in first. Sign in, open the form, then Start autofill.");
  }
  if (after.logs.some((entry) => /Detected \d+ fields/.test(entry.message))) return true;
  if (after.currentStep) return true;
  throw new Error(
    `Form not detected on this tab (${tab.url ?? "unknown URL"}). Click Continue Application, wait for the form (My Experience / name fields), then Start autofill.`,
  );
}

async function sendScan(tabId: number) {
  try {
    await chrome.tabs.sendMessage(tabId, { type: "SCAN_FIELDS" });
    return;
  } catch {
    session.log("warn", "Content script missing — injecting it into this tab.");
  }

  const files = chrome.runtime.getManifest().content_scripts?.[0]?.js ?? [];
  if (!files.length) {
    throw new Error(`Refresh the ${ACTIVE.company} form tab (F5), then click Start autofill.`);
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files,
    });
    await sleep(500);
    await chrome.tabs.sendMessage(tabId, { type: "SCAN_FIELDS" });
  } catch {
    throw new Error(
      `Could not reach the ${ACTIVE.company} form. Click Continue Application, press F5 on the form page, then Start autofill. Also allow site access for myworkdayjobs.com and myworkday.com.`,
    );
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function onFieldsDetected(stepName: string, fields: FormField[], tabId?: number) {
  const state = session.getState();
  if (state.phase !== "filling" && state.phase !== "waiting_login") return null;
  if (!state.profile) return null;

  session.patch({ currentStep: stepName, phase: "filling" });
  session.log("info", `Detected ${fields.length} fields on "${stepName}".`);

  const key = await store.getApiKey();
  let merged: FillPlan[] = [];
  try {
    merged = await mapFields({
      apiKey: key,
      profile: state.profile,
      preferences: state.preferences,
      fields,
    });
    session.log("info", `Mapped ${merged.length} fields (${key ? "AI + heuristics" : "heuristics only"}).`);
  } catch (error) {
    session.log("warn", `AI mapping failed, retrying heuristics only. ${(error as Error).message}`);
    merged = await mapFields({
      apiKey: "",
      profile: state.profile,
      preferences: state.preferences,
      fields,
    });
  }

  merged = merged.filter((p) => {
    if (p.source === "skip") return true;
    if (p.confidence === "low") {
      p.source = "skip";
      p.reason = p.reason || "Low confidence — left blank for review";
      return true;
    }
    return Boolean(p.value) || p.value === false;
  });

  if (tabId) {
    await chrome.tabs.sendMessage(tabId, {
      type: "APPLY_FILL_PLAN",
      plan: merged,
      stepName,
    });
  }
  return merged;
}

async function onFillDone(review: ReviewSummary) {
  session.setReview(review);
  const filled = review.filled.filter((f) => f.ok).length;
  session.log("info", `Filled ${filled}/${review.filled.length} fields on ${review.stepName}.`);

  const isReviewStep = /review|submit|self identify|self-identify/i.test(review.stepName);
  if (isReviewStep) {
    session.setPhase("review");
    session.log("info", "Review step reached. Confirm in the side panel to submit.");
    return true;
  }

  if (/experience/i.test(review.stepName) && session.getState().logs.some((entry) => /Resume\/CV is required/i.test(entry.message))) {
    session.log("warn", "Waiting for you to drop the resume PDF, then click Start autofill.");
    return true;
  }

  session.log("info", "Moving to the next Workday step…");
  await sleep(500);
  await sendToActiveTab({ type: "CLICK_NEXT" });
  return true;
}

function isWorkdayUrl(url?: string): boolean {
  if (!url) return false;
  return /myworkdayjobs\.com|myworkday\.com|\.workday\.com/i.test(url);
}

async function getWorkdayTab(): Promise<chrome.tabs.Tab | undefined> {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isWorkdayUrl(active?.url)) return active;
  const tabs = await chrome.tabs.query({});
  return tabs.find((tab) => isWorkdayUrl(tab.url));
}

async function sendToActiveTab(message: RuntimeMessage) {
  const tab = await getWorkdayTab();
  if (!tab?.id) throw new Error("No Workday tab found.");
  await chrome.tabs.sendMessage(tab.id, message);
}

import type { RuntimeMessage } from "../types/messages";
import type { FillPlan, ReviewSummary } from "../types/field";
import {
  detectFields,
  detectLogin,
  detectStepName,
  validationMessages,
} from "./detector";
import { applyFillPlan } from "./filler";
import { clickNext, clickSubmit, ensureEducationRows, ensureExperienceRows } from "./navigator";
import { applyKnownWorkdayAnswers } from "./workdayFixes";
import { onSpaNavigation, sleep, waitForIdle } from "./observer";
import { attachStoredResume, pageHasUploadedFile } from "./resumeUpload";

let busy = false;

void boot();

async function boot() {
  await waitForIdle();
  notifyReady();
  onSpaNavigation(() => {
    void waitForIdle().then(notifyReady);
  });
}

function notifyReady() {
  if (detectLogin()) {
    void chrome.runtime.sendMessage({ type: "LOGIN_REQUIRED" });
    return;
  }
  void chrome.runtime.sendMessage({
    type: "CONTENT_READY",
    url: location.href,
    title: document.title,
  });
}

chrome.runtime.onMessage.addListener((message: RuntimeMessage, _sender, sendResponse) => {
  void dispatch(message)
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error: Error) => {
      void chrome.runtime.sendMessage({ type: "CONTENT_ERROR", message: error.message });
      sendResponse({ ok: false, error: error.message });
    });
  return true;
});

async function dispatch(message: RuntimeMessage) {
  switch (message.type) {
    case "SCAN_FIELDS":
      return scanAndReport(true);
    case "APPLY_FILL_PLAN":
      return fillCurrentStep(message.plan, message.stepName);
    case "CLICK_NEXT":
      return goNext();
    case "CLICK_SUBMIT":
      return submit();
    default:
      return null;
  }
}

async function scanAndReport(force = false) {
  if (busy && !force) return;
  busy = false;
  await waitForIdle();

  if (detectLogin()) {
    await chrome.runtime.sendMessage({ type: "LOGIN_REQUIRED" });
    return;
  }

  const stepName = detectStepName();
  await chrome.runtime.sendMessage({ type: "STEP_DETECTED", stepName, url: location.href });

  if (/experience/i.test(stepName)) {
    await attachStoredResume();
    window.scrollTo({ top: document.body.scrollHeight, behavior: "instant" });
    await sleep(400);
    await ensureExperienceRows(3);
    await ensureEducationRows(2);
    window.scrollTo({ top: 0, behavior: "instant" });
    await waitForIdle();
  }
  if (/education/i.test(stepName) && !/experience/i.test(stepName)) {
    await ensureEducationRows(2);
  }

  const fields = detectFields();
  if (fields.length < 1 && window !== window.top) return;
  await chrome.runtime.sendMessage({ type: "FIELDS_DETECTED", stepName, fields });
}

async function fillCurrentStep(plan: FillPlan[], stepName: string) {
  busy = true;
  try {
    let filled = await applyFillPlan(plan);
    await applyKnownWorkdayAnswers();
    await sleep(300);
    await applyKnownWorkdayAnswers();
    await sleep(250);
    if (validationMessages().length) {
      filled = await applyFillPlan(plan);
      await applyKnownWorkdayAnswers();
      await sleep(250);
    }
    const skipped = plan.filter((p) => p.source === "skip" || p.confidence === "low");
    const review: ReviewSummary = {
      stepName,
      filled,
      skipped,
      errors: filled.filter((f) => !f.ok).map((f) => f.error || f.label),
    };
    if (/experience/i.test(stepName) && !pageHasUploadedFile()) {
      await chrome.runtime.sendMessage({
        type: "CONTENT_ERROR",
        message: "Resume/CV is required. Drop your PDF into the upload box, then click Start autofill.",
      });
    }
    busy = false;
    await chrome.runtime.sendMessage({ type: "FILL_DONE", stepName, review });
    return review;
  } finally {
    busy = false;
  }
}

async function goNext() {
  const result = await clickNext();
  if (!result.ok) {
    await chrome.runtime.sendMessage({ type: "VALIDATION_ERRORS", messages: result.errors });
    return result;
  }
  await sleep(900);
  await waitForIdle(600, 15000);
  await scanAndReport(true);
  return result;
}

async function submit() {
  const ok = await clickSubmit();
  if (!ok) throw new Error("Submit button not found. Stay on the Workday Review page.");
  await chrome.runtime.sendMessage({ type: "SUBMIT_DONE" });
  return true;
}

import { normalize } from "../lib/fuzzy";
import { queryAll } from "./detector";
import { sleep, waitForIdle } from "./observer";

import { ACTIVE, candidatesFor } from "../config/target";
import type { UserPreferences } from "../types/resume";

/** Workday-specific required questions that generic mapping often misses. */
export async function applyKnownWorkdayAnswers(): Promise<string[]> {
  const done: string[] = [];
  closeMenus();
  await sleep(120);

  if (await uncheckPreferredName()) done.push("Unchecked preferred name");
  if (await clickAnswerNearQuestion(/previously employed/i, ["No"])) {
    done.push("Previously employed = No");
  }
  if (await fillHowDidYouHear()) done.push("How did you hear = selected");
  await applyApplicationQuestions();
  if (await checkConsent()) done.push("Consented to terms");
  await fillSelfIdentify();
  await clickPromptForQuestion(/veteran status/i, [
    "I am not a protected veteran",
    "I am not a veteran",
    "No, I am not a veteran",
    "I don't wish to answer",
    "I do not want to answer",
    "Decline to self identify",
    "Decline to self-identify",
  ]);

  return done;
}

async function checkConsent(): Promise<boolean> {
  const label = queryAll("label, div, span").find((el) => {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    return /consent to the (above )?terms/i.test(text) && text.length < 160;
  });
  if (!label) return false;
  const box =
    (label.querySelector("input[type='checkbox']") as HTMLInputElement | null) ??
    (label.closest("label")?.querySelector("input[type='checkbox']") as HTMLInputElement | null) ??
    (label.parentElement?.querySelector("input[type='checkbox']") as HTMLInputElement | null);
  if (!box) return false;
  if (!box.checked) {
    box.click();
    await sleep(120);
  }
  return box.checked;
}

async function clickPromptForQuestion(question: RegExp, options: string[]): Promise<boolean> {
  const root = questionRoot(question);
  if (!root) return false;
  const trigger =
    (root.querySelector("[role='combobox'], button, [data-automation-id='selectWidget'], [aria-haspopup='listbox']") as HTMLElement | null) ??
    (root.querySelector("input:not([type='hidden'])") as HTMLElement | null);
  if (!trigger) return false;
  closeMenus();
  await sleep(80);
  realClick(trigger);
  await waitForOptions();
  const ok = await clickPromptOption(options);
  await sleep(200);
  closeMenus();
  return ok;
}

async function applyApplicationQuestions(): Promise<void> {
  const state = await chrome.runtime.sendMessage({ type: "GET_STATE" });
  const prefs = state?.result?.preferences ?? {
    requireSponsorship: false,
    authorizedToWork: true,
  };

  // Driven by src/config/target.ts - the DOM pass and the heuristic mapper
  // answer the same questions from the same declarations, so they cannot drift.
  for (const rule of ACTIVE.questions) {
    const candidates = candidatesFor(rule, prefs as UserPreferences);
    if (!candidates.length) continue;
    await clickPromptForQuestion(rule.match, candidates);
  }
  await fillMaskedDate(/notice period|availability to start/i, 14);
}

async function selectYesNo(question: RegExp, answer: "Yes" | "No"): Promise<boolean> {
  const root = questionRoot(question);
  if (!root) return false;
  const trigger =
    (root.querySelector("[role='combobox'], button, [data-automation-id='selectWidget'], [aria-haspopup='listbox']") as HTMLElement | null) ??
    (root.querySelector("input:not([type='hidden'])") as HTMLElement | null);
  if (!trigger) return false;
  closeMenus();
  await sleep(80);
  realClick(trigger);
  await waitForOptions();
  const ok = await clickPromptOption([answer]);
  if (!ok) {
    const node = visiblePromptOptions().find((el) => normalize(el.textContent || "") === normalize(answer));
    if (node) realClick(node);
  }
  await sleep(200);
  closeMenus();
  return true;
}

async function fillSelfIdentify(): Promise<void> {
  await fillPlaceholderDates(0);
  await clickExactOption("I do not want to answer");
}

async function clickExactOption(answer: string): Promise<boolean> {
  const wanted = normalize(answer);
  const nodes = queryAll("label, span, div, [role='radio'], [role='checkbox']")
    .filter((el) => {
      const text = normalize(el.textContent ?? "");
      return text === wanted && (el.textContent ?? "").trim().length < 80;
    })
    .sort((a, b) => (a.textContent?.length ?? 99) - (b.textContent?.length ?? 99));
  const node = nodes[0];
  if (!node) return false;
  const input =
    (node.querySelector("input") as HTMLInputElement | null) ??
    (node.closest("label")?.querySelector("input") as HTMLInputElement | null);
  realClick(input ?? node);
  await sleep(150);
  return true;
}

async function fillPlaceholderDates(daysFromNow: number): Promise<void> {
  const when = new Date();
  when.setDate(when.getDate() + daysFromNow);
  const digits = `${String(when.getMonth() + 1).padStart(2, "0")}${String(when.getDate()).padStart(2, "0")}${when.getFullYear()}`;
  const inputs = queryAll("input").filter((el) => {
    const ph = (el.getAttribute("placeholder") ?? "").toUpperCase();
    return ph.includes("MM") && ph.includes("DD") && ph.includes("YYYY");
  }) as HTMLInputElement[];
  for (const input of inputs) {
    input.scrollIntoView({ block: "center" });
    input.focus();
    input.click();
    await sleep(40);
    input.select();
    document.execCommand("selectAll");
    document.execCommand("delete");
    for (let i = 0; i < 10; i += 1) {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, composed: true }));
    }
    input.value = "";
    await sleep(40);
    for (const char of digits) {
      document.execCommand("insertText", false, char);
      await sleep(25);
    }
    input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
    input.blur();
    await sleep(80);
  }
}

async function fillMaskedDate(question: RegExp, daysFromNow: number): Promise<boolean> {
  const root = questionRoot(question) ?? questionRoot(/availability to start|notice period/i);
  const inputs = queryAll("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])");
  const input = (root?.querySelector("input:not([type='hidden']):not([type='checkbox'])") as HTMLInputElement | null)
    ?? inputs.find((el) => /date|mm\/dd/i.test(`${el.getAttribute("placeholder") ?? ""} ${el.getAttribute("aria-label") ?? ""}`)) as HTMLInputElement | undefined
    ?? null;
  if (!input) return false;
  const when = new Date();
  when.setDate(when.getDate() + daysFromNow);
  const digits = `${String(when.getMonth() + 1).padStart(2, "0")}${String(when.getDate()).padStart(2, "0")}${when.getFullYear()}`;
  input.scrollIntoView({ block: "center" });
  input.focus();
  input.click();
  input.select();
  document.execCommand("selectAll");
  document.execCommand("delete");
  await sleep(30);
  for (const char of digits) {
    document.execCommand("insertText", false, char);
    input.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, data: char, inputType: "insertText" }));
    await sleep(20);
  }
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  input.blur();
  await sleep(120);
  return true;
}

function closeMenus() {
  document.body.click();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, composed: true }));
}

async function uncheckPreferredName(): Promise<boolean> {
  const label = queryAll("label").find((el) => /^i have a preferred name$/i.test((el.textContent ?? "").trim()));
  if (!label) return false;
  const box =
    (label.querySelector("input[type='checkbox']") as HTMLInputElement | null) ??
    (label.closest("label")?.querySelector("input[type='checkbox']") as HTMLInputElement | null);
  if (box?.checked) {
    box.click();
    await sleep(120);
    return true;
  }
  return false;
}

async function clickAnswerNearQuestion(question: RegExp, answers: string[]): Promise<boolean> {
  const root = questionRoot(question);
  if (!root) return false;

  for (const answer of answers) {
    const hit = clickableIn(root).find((el) => {
      const text = normalize(el.textContent ?? el.getAttribute("aria-label") ?? "");
      const auto = (el.getAttribute("data-automation-id") ?? "").toLowerCase();
      return text === normalize(answer) || auto.endsWith(answer.toLowerCase());
    });
    if (hit) {
      realClick(hit);
      await sleep(150);
      return true;
    }
  }
  return false;
}

async function fillHowDidYouHear(): Promise<boolean> {
  const root = questionRoot(/how did you hear/i);
  if (!root) return false;

  const input = root.querySelector("input:not([type='hidden']):not([type='checkbox']):not([type='radio'])") as HTMLInputElement | null;
  const trigger = (input as HTMLElement | null)
    ?? (root.querySelector("[role='combobox'], button, [data-automation-id='selectWidget']") as HTMLElement | null);
  if (!trigger) return false;

  if (hasCommittedSelection(root)) return true;

  if (input) {
    input.focus();
    input.select();
    document.execCommand("delete");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  }

  realClick(trigger);
  await sleep(250);
  if (input) realClick(input);
  await waitForOptions();

  const parents = ACTIVE.sourceCategories;
  const leaves = ACTIVE.sourceLeaves;

  await clickPromptOption(parents);
  await sleep(400);
  await waitForOptions();
  const leafClicked = await clickPromptOption(leaves);
  if (!leafClicked) {
    const leftover = visiblePromptOptions().filter((el) => {
      const text = normalize(el.textContent || "");
      return text && !parents.some((p) => text === normalize(p));
    });
    if (leftover[0]) {
      realClick(leftover[0]);
      await sleep(200);
    }
  }

  await sleep(250);
  closeMenus();
  return hasCommittedSelection(root);
}

async function waitForOptions(): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < 3500) {
    if (visiblePromptOptions().length) return;
    await sleep(100);
  }
}

function visiblePromptOptions(): HTMLElement[] {
  return queryAll("[data-automation-id='promptOption'], [role='option']").filter((el) => {
    const text = (el.textContent ?? "").trim();
    if (!text || text.length > 80) return false;
    if (/\(\+\d+\)/.test(text)) return false;
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0;
  });
}

async function clickPromptOption(names: string[]): Promise<boolean> {
  const options = visiblePromptOptions();
  for (const name of names) {
    const node = options.find((el) => {
      const text = normalize(el.getAttribute("aria-label") || el.textContent || "");
      return text === normalize(name) || text.includes(normalize(name));
    });
    if (!node) continue;
    const inner = (node.querySelector("div, span, p") as HTMLElement | null) ?? node;
    realClick(inner);
    realClick(node);
    await sleep(180);
    return true;
  }
  return false;
}

function hasCommittedSelection(root: HTMLElement): boolean {
  return Boolean(
    root.querySelector(
      '[data-automation-id="selectedItem"], [data-automation-id*="pill"], [data-automation-id="promptSelectedOption"], [data-automation-id="DELETE_charm"]',
    ),
  );
}

function realClick(el: HTMLElement) {
  el.scrollIntoView({ block: "center", inline: "nearest" });
  const rect = el.getBoundingClientRect();
  const opts: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    composed: true,
    view: window,
    clientX: rect.left + Math.min(20, rect.width / 2),
    clientY: rect.top + rect.height / 2,
  };
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", opts));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", opts));
  el.dispatchEvent(new MouseEvent("click", opts));
  el.click();
}

function questionRoot(question: RegExp): HTMLElement | null {
  const labels = queryAll("label, legend, [data-automation-id*='label']").filter((el) => {
    if (el.closest("[data-automation-id*='error'], [data-automation-id='errorList']")) return false;
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (/is required|must have a value|errors found/i.test(text)) return false;
    return question.test(text) && text.length < 400;
  });
  const match = labels[0];
  if (!match) return null;
  return (
    (match.closest("[data-automation-id*='formField'], [data-automation-id*='Field'], fieldset, [role='group']") as HTMLElement | null) ??
    match.parentElement
  );
}

function clickableIn(root: HTMLElement): HTMLElement[] {
  return queryAll("input, button, label, [role='radio'], [data-automation-id]", root);
}

import { findNextButton, findSubmitButton, validationMessages } from "./detector";
import { sleep, waitForIdle } from "./observer";

export async function clickNext(): Promise<{ ok: boolean; errors: string[] }> {
  const button = findNextButton();
  if (!button) return { ok: false, errors: ["Next button not found"] };
  button.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  await sleep(100);
  button.click();
  await sleep(400);
  await waitForIdle();
  const errors = validationMessages();
  return { ok: errors.length === 0, errors };
}

export async function clickSubmit(): Promise<boolean> {
  const button = findSubmitButton();
  if (!button) return false;
  button.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  await sleep(120);
  button.click();
  await sleep(600);
  await waitForIdle();
  return true;
}

export async function ensureExperienceRows(needed: number): Promise<number> {
  let existing = countRepeatable("experience", "job", "work");
  let guard = 0;
  while (existing < needed && guard < 6) {
    const added = clickAdd("Add Another", "Add Job", "Add Work Experience", "Add Experience");
    if (!added) break;
    await sleep(300);
    await waitForIdle(300, 5000);
    existing = countRepeatable("experience", "job", "work");
    guard += 1;
  }
  return existing;
}

export async function ensureEducationRows(needed: number): Promise<number> {
  let existing = countRepeatable("education", "school", "degree");
  let guard = 0;
  while (existing < needed && guard < 4) {
    const added = clickAdd("Add Another", "Add Education", "Add School", "Add Degree");
    if (!added) break;
    await sleep(300);
    await waitForIdle(300, 5000);
    existing = countRepeatable("education", "school", "degree");
    guard += 1;
  }
  return existing;
}

function clickAdd(...labels: string[]): boolean {
  const buttons = [...document.querySelectorAll("button, [role='button'], a")] as HTMLElement[];
  const hit = buttons.find((el) => {
    const text = `${el.innerText} ${el.getAttribute("aria-label") ?? ""}`;
    return labels.some((label) => new RegExp(label, "i").test(text));
  });
  hit?.click();
  return Boolean(hit);
}

function countRepeatable(...needles: string[]): number {
  const blocks = [...document.querySelectorAll("[data-automation-id*='formField'], section, [data-automation-id*='panel']")];
  const hits = blocks.filter((el) => {
    const auto = (el.getAttribute("data-automation-id") || "").toLowerCase();
    return needles.some((n) => auto.includes(n));
  });
  return Math.max(1, Math.min(hits.length, 8));
}

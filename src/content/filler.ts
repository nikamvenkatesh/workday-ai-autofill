import { bestOptionMatch, normalize } from "../lib/fuzzy";
import type { FillPlan, FillResult } from "../types/field";
import { findByFieldId, queryAll } from "./detector";
import { sleep, waitForIdle } from "./observer";

export async function applyFillPlan(plan: FillPlan[]): Promise<FillResult[]> {
  const results: FillResult[] = [];
  for (const item of plan) {
    if (item.source === "skip" || item.confidence === "low") {
      results.push({ fieldId: item.fieldId, label: item.label, ok: true, value: "" });
      continue;
    }
    const el = findByFieldId(item.fieldId);
    if (!el) {
      results.push({ fieldId: item.fieldId, label: item.label, ok: false, error: "Field not found" });
      continue;
    }
    try {
      await fillElement(el, item.value);
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        ok: true,
        value: stringify(item.value),
      });
      await sleep(120);
    } catch (error) {
      results.push({
        fieldId: item.fieldId,
        label: item.label,
        ok: false,
        error: (error as Error).message,
      });
    }
  }
  return results;
}

async function fillElement(el: HTMLElement, value: string | string[] | boolean) {
  const type = (el.getAttribute("type") || "").toLowerCase();
  const role = el.getAttribute("role") || "";
  const auto = (el.getAttribute("data-automation-id") || "").toLowerCase();
  const label = `${el.getAttribute("aria-label") ?? ""} ${auto}`;

  if (type === "checkbox" || (el instanceof HTMLInputElement && el.type === "checkbox")) {
    await setCheckbox(el as HTMLInputElement, Boolean(value));
    return;
  }
  if (type === "radio" || (el instanceof HTMLInputElement && el.type === "radio")) {
    await setRadio(el, stringify(value));
    return;
  }
  if (el instanceof HTMLSelectElement) {
    await setSelect(el, stringify(value));
    return;
  }
  if (
    role === "combobox" ||
    auto.includes("select") ||
    auto.includes("dropdown") ||
    auto.includes("prompt") ||
    looksLikeCombo(el)
  ) {
    await setCombobox(el, stringify(value));
    return;
  }
  if (/hear about|source/i.test(label) && !(el instanceof HTMLInputElement && el.type === "text")) {
    await setCombobox(el, stringify(value));
    return;
  }

  let text = stringify(value);
  if (type === "date" || auto.includes("date") || /notice|start date|mm\/dd/i.test(label)) {
    text = text.replace(/\D/g, "");
  }
  await setText(el, text, true);
}

async function setText(el: HTMLElement, value: string, commit = true) {
  const target = resolveInput(el);
  target.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  target.click();
  target.focus();
  await sleep(60);

  clearField(target);
  await sleep(40);

  const inserted = document.execCommand("insertText", false, value);
  if (!inserted || !valueMatches(target, value)) {
    await typeChars(target, value);
  }
  if (!valueMatches(target, value)) {
    setNativeValue(target, value);
    syncReactTracker(target, value);
    fireInput(target, value, "insertText");
  }

  target.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  if (commit) {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true, composed: true }));
    target.blur();
    target.dispatchEvent(new FocusEvent("blur", { bubbles: true, composed: true }));
    target.dispatchEvent(new FocusEvent("focusout", { bubbles: true, composed: true }));
  }
  await sleep(80);
}

function resolveInput(el: HTMLElement): HTMLElement {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return el;
  const inner = el.querySelector("input:not([type='hidden']):not([type='checkbox']):not([type='radio']), textarea") as HTMLElement | null;
  if (inner) return inner;
  if (el.shadowRoot) {
    const shadow = el.shadowRoot.querySelector("input, textarea") as HTMLElement | null;
    if (shadow) return shadow;
  }
  return el;
}

function clearField(target: HTMLElement) {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    target.select();
  } else {
    document.execCommand("selectAll");
  }
  document.execCommand("delete");
  setNativeValue(target, "");
  syncReactTracker(target, "");
  fireInput(target, "", "deleteContentBackward");
  target.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, composed: true, cancelable: true }));
}

async function typeChars(target: HTMLElement, value: string) {
  setNativeValue(target, "");
  syncReactTracker(target, "");
  let acc = "";
  for (const char of value) {
    acc += char;
    target.dispatchEvent(new KeyboardEvent("keydown", { key: char, bubbles: true, composed: true, cancelable: true }));
    target.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      composed: true,
      data: char,
      inputType: "insertText",
    }));
    setNativeValue(target, acc);
    syncReactTracker(target, acc);
    fireInput(target, char, "insertText");
    target.dispatchEvent(new KeyboardEvent("keyup", { key: char, bubbles: true, composed: true }));
    await sleep(12);
  }
}

function setNativeValue(el: HTMLElement, value: string) {
  const proto = el instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
  if (descriptor?.set) descriptor.set.call(el, value);
  else if ("value" in el) (el as HTMLInputElement).value = value;
}

function syncReactTracker(el: HTMLElement, value: string) {
  const tracker = (el as unknown as { _valueTracker?: { setValue: (v: string) => void } })._valueTracker;
  if (!tracker) return;
  tracker.setValue("");
  setNativeValue(el, value);
}

function fireInput(el: HTMLElement, data: string, inputType: string) {
  el.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    composed: true,
    data,
    inputType,
  }));
}

function valueMatches(el: HTMLElement, value: string): boolean {
  const current = "value" in el ? String((el as HTMLInputElement).value) : (el.textContent ?? "");
  return normalize(current) === normalize(value);
}

async function setCheckbox(el: HTMLInputElement, checked: boolean) {
  if (el.checked === checked) return;
  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  el.click();
  if (el.checked !== checked) {
    el.checked = checked;
    el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  }
}

async function setSelect(el: HTMLSelectElement, value: string) {
  const options = [...el.options].map((o) => o.textContent?.trim() || o.value);
  const match = bestOptionMatch(value, options);
  if (!match) throw new Error(`No select option for "${value}"`);
  const option = [...el.options].find((o) => (o.textContent?.trim() || o.value) === match);
  if (!option) throw new Error(`Option missing: ${match}`);
  el.value = option.value;
  el.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  el.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
}

async function setRadio(el: HTMLElement, value: string) {
  const name = el.getAttribute("name");
  const radios = name
    ? queryAll(`input[type='radio'][name='${CSS.escape(name)}']`)
    : [el];
  const wanted = radios.find((r) => {
    const label = r.closest("label")?.innerText || r.getAttribute("aria-label") || (r as HTMLInputElement).value;
    return normalize(label) === normalize(value) || normalize(label).includes(normalize(value));
  });
  (wanted ?? el).click();
}

async function setCombobox(el: HTMLElement, value: string) {
  document.body.click();
  await sleep(80);

  el.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
  const trigger = (el.querySelector("input, button, [role='button']") as HTMLElement | null) ?? el;
  trigger.click();
  await sleep(280);
  await waitForIdle(200, 4000);

  const scope = (el.closest("[data-automation-id*='formField'], [data-automation-id*='Field']") as HTMLElement | null) ?? el;
  const search = trigger instanceof HTMLInputElement
    ? trigger
    : (scope.querySelector("input:not([type='hidden'])") as HTMLInputElement | null);

  const namedPick = /job board|career website|employee referral|campus|linkedin|other/i.test(value);
  if (search && !namedPick && !/^\d+$/.test(value)) {
    await setText(search, value, false);
    await sleep(220);
    await waitForIdle(200, 4000);
  }

  const options = queryAll("[role='option'], [data-automation-id='promptOption'], li[id*='option']")
    .filter((o) => (o.textContent?.trim() ?? "").length > 0);
  const labels = options.map((o) => o.textContent?.trim() ?? "");
  const match = bestOptionMatch(value, labels);

  if (!match) {
    document.body.click();
    throw new Error(`No dropdown option for "${value}"`);
  }
  const node = options.find((o) => o.textContent?.trim() === match);
  node?.scrollIntoView({ block: "nearest" });
  node?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, composed: true }));
  node?.click();
  await sleep(150);
  document.body.click();
}

function looksLikeCombo(el: HTMLElement): boolean {
  return Boolean(
    el.closest("[data-automation-id*='select'], [data-automation-id*='dropdown'], [data-automation-id='selectWidget'], [data-automation-id*='prompt']"),
  );
}

function stringify(value: string | string[] | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

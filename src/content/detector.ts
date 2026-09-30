import type { FieldType, FormField } from "../types/field";
import { normalize } from "../lib/fuzzy";

const ATTR = "data-wdaf-id";

export function detectLogin(): boolean {
  const text = document.body?.innerText?.slice(0, 4000) ?? "";
  if (/sign in|log in|forgot password/i.test(text) && queryAll("input[type='password']").length) {
    return true;
  }
  return Boolean(
    queryAll('[data-automation-id="signInSubmitButton"], [data-automation-id="loginButton"]').length,
  );
}

export function detectStepName(): string {
  const steps = [
    "My Information",
    "My Experience",
    "Application Questions",
    "Voluntary Disclosures",
    "Self Identify",
    "Self-Identification",
    "Review",
  ];

  const current = queryAll('[aria-current="step"], [aria-current="page"], [data-automation-id*="progress"] *, nav *')
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .find((text) => steps.some((step) => text === step || text.startsWith(step)));
  if (current) {
    return steps.find((step) => current.startsWith(step)) ?? current;
  }

  const body = (document.body?.innerText ?? "").slice(0, 8000);
  const found = steps.find((step) => new RegExp(step, "i").test(body));
  if (found) return found;

  const heading = queryAll("h1, h2, [data-automation-id='pageHeader'], [data-automation-id='headerTitle']")
    .map((el) => el.textContent?.trim() ?? "")
    .find((t) => t.length > 2 && t.length < 80);
  return heading || document.title || "Application";
}

export function detectFields(): FormField[] {
  const fields: FormField[] = [];
  const seen = new Set<string>();
  let index = 0;

  for (const el of interactiveElements()) {
    if (!isVisible(el) || isIgnored(el)) continue;
    const type = classify(el);
    if (type === "unknown" && el.getAttribute("role") !== "combobox") continue;

    const id = stamp(el, index);
    index += 1;
    if (seen.has(id)) continue;
    seen.add(id);

    const label = getLabel(el);
    if (!label && type === "unknown") continue;

    fields.push({
      id,
      label: label || el.getAttribute("data-automation-id") || `Field ${index}`,
      type,
      required: isRequired(el),
      options: type === "select" || type === "radio" ? collectOptions(el) : undefined,
      currentValue: currentValue(el, type),
      section: nearestSection(el),
      automationId: el.getAttribute("data-automation-id") || undefined,
    });
  }

  return fields;
}

export function findByFieldId(id: string): HTMLElement | null {
  return queryAll(`[${ATTR}="${cssEscape(id)}"]`)[0] ?? null;
}

export function findNextButton(): HTMLElement | null {
  return findButton([
    '[data-automation-id="bottom-navigation-next-button"]',
    '[data-automation-id="pageFooterNextButton"]',
    '[data-automation-id="wd-CommandButton_next"]',
    'button[aria-label="Next"]',
  ], /^(next|continue|save and continue)$/i);
}

export function findSubmitButton(): HTMLElement | null {
  return findButton([
    '[data-automation-id="bottom-navigation-submit-button"]',
    '[data-automation-id="pageFooterSubmitButton"]',
    'button[aria-label="Submit"]',
  ], /^submit$/i);
}

export function validationMessages(): string[] {
  return queryAll('[data-automation-id="errorMessage"], [data-automation-id="errorList"] li')
    .map((el) => (el.textContent ?? "").replace(/\s+/g, " ").trim())
    .filter((t) => t.length > 2 && t.length < 220 && /required|invalid|must have/i.test(t))
    .slice(0, 8);
}

export function queryAll(selector: string, root: ParentNode = document): HTMLElement[] {
  const out: HTMLElement[] = [];
  const visit = (node: ParentNode) => {
    if ("querySelectorAll" in node) {
      node.querySelectorAll(selector).forEach((el) => out.push(el as HTMLElement));
    }
    const elements = "querySelectorAll" in node ? node.querySelectorAll("*") : [];
    for (const el of elements) {
      if (el instanceof HTMLElement && el.shadowRoot) visit(el.shadowRoot);
    }
  };
  visit(root);
  return out;
}

function interactiveElements(): HTMLElement[] {
  return queryAll(
    [
      "input:not([type='hidden']):not([type='submit']):not([type='button']):not([type='image'])",
      "textarea",
      "select",
      "[role='combobox']",
      "[role='radio']",
      "[role='listbox']",
      "[data-automation-id='selectWidget']",
      "[data-automation-id*='selectOne']",
      "[aria-haspopup='listbox']",
      "[data-automation-id*='radio']",
      "[data-automation-id*='dateInput'] input",
      "[data-automation-id*='formField'] input",
      "[data-automation-id*='formField'] textarea",
      "[data-automation-id*='formField'] select",
    ].join(","),
  );
}

function classify(el: HTMLElement): FieldType {
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const auto = (el.getAttribute("data-automation-id") || "").toLowerCase();
  const role = el.getAttribute("role") || "";

  if (type === "file") return "file";
  if (type === "checkbox") return "checkbox";
  if (type === "radio" || role === "radio" || auto.includes("radio")) return "radio";
  if (type === "date" || auto.includes("date") || /date|month|year/.test(auto)) return "date";
  if (tag === "select" || role === "combobox" || auto.includes("select") || auto.includes("dropdown")) {
    return "select";
  }
  if (tag === "textarea" || el.getAttribute("aria-multiline") === "true") return "textarea";
  if (tag === "input" || el.isContentEditable) return "text";
  return "unknown";
}

function isIgnored(el: HTMLElement): boolean {
  const type = (el.getAttribute("type") || "").toLowerCase();
  if (["hidden", "submit", "button", "reset", "image"].includes(type)) return true;
  if (el.closest("[aria-hidden='true']")) return true;
  const auto = el.getAttribute("data-automation-id") || "";
  if (/search|filter|cookie/i.test(auto)) return true;
  return false;
}

function isVisible(el: HTMLElement): boolean {
  const rect = el.getBoundingClientRect();
  if (rect.width < 2 && rect.height < 2) return false;
  const style = window.getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

function isRequired(el: HTMLElement): boolean {
  if (el.getAttribute("aria-required") === "true" || el.hasAttribute("required")) return true;
  const wrap = el.closest("[data-automation-id*='formField'], label, div");
  return Boolean(wrap?.textContent?.includes("*"));
}

function stamp(el: HTMLElement, index: number): string {
  const existing = el.getAttribute(ATTR);
  if (existing) return existing;
  const auto = el.getAttribute("data-automation-id");
  const id = auto && auto.length < 80 ? auto : `wdaf-${index}-${Date.now().toString(36)}`;
  el.setAttribute(ATTR, id);
  return id;
}

function getLabel(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria?.trim()) return cleanLabel(aria);

  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent?.trim() ?? "")
      .join(" ")
      .trim();
    if (text) return cleanLabel(text);
  }

  if ("labels" in el && (el as HTMLInputElement).labels?.length) {
    const text = [...(el as HTMLInputElement).labels!].map((l) => l.innerText).join(" ");
    if (text.trim()) return cleanLabel(text);
  }

  const wrap = el.closest("[data-automation-id*='formField'], [data-automation-id*='Field']");
  const wrapLabel = wrap?.querySelector("label, legend, [data-automation-id*='label']");
  if (wrapLabel?.textContent) return cleanLabel(wrapLabel.textContent);

  const prev = el.parentElement?.querySelector("label");
  if (prev?.textContent) return cleanLabel(prev.textContent);

  return cleanLabel(el.getAttribute("placeholder") || el.getAttribute("data-automation-id") || "");
}

function cleanLabel(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\*$/, "").trim();
}

function currentValue(el: HTMLElement, type: FieldType): string {
  if (type === "checkbox") return (el as HTMLInputElement).checked ? "true" : "false";
  if (type === "radio") return (el as HTMLInputElement).checked ? (el as HTMLInputElement).value : "";
  if ("value" in el) return String((el as HTMLInputElement).value ?? "");
  return el.textContent?.trim() ?? "";
}

function collectOptions(el: HTMLElement): string[] {
  if (el instanceof HTMLSelectElement) {
    return [...el.options].map((o) => o.textContent?.trim() ?? "").filter(Boolean);
  }
  const groupName = el.getAttribute("name");
  if (el instanceof HTMLInputElement && el.type === "radio" && groupName) {
    return queryAll(`input[type='radio'][name='${cssEscape(groupName)}']`)
      .map((r) => getLabel(r) || (r as HTMLInputElement).value)
      .filter(Boolean);
  }
  const listId = el.getAttribute("aria-controls") || el.getAttribute("aria-owns");
  if (listId) {
    const list = document.getElementById(listId);
    if (list) {
      return [...list.querySelectorAll("[role='option'], li")].map((o) => o.textContent?.trim() ?? "").filter(Boolean);
    }
  }
  return [];
}

function nearestSection(el: HTMLElement): string {
  const heading = el.closest("section, [data-automation-id*='section'], form")
    ?.querySelector("h2, h3, legend, [data-automation-id*='panelTitle']");
  return heading?.textContent?.trim() || detectStepName();
}

function findButton(selectors: string[], textRe: RegExp): HTMLElement | null {
  for (const selector of selectors) {
    const hit = queryAll(selector).find(isVisible);
    if (hit) return hit;
  }
  return queryAll("button, [role='button'], a")
    .filter(isVisible)
    .find((el) => {
      const text = normalize(el.innerText || el.getAttribute("aria-label") || "");
      return textRe.test(text) || text.includes("save and continue");
    }) ?? null;
}

function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && CSS.escape) return CSS.escape(value);
  return value.replace(/"/g, '\\"');
}

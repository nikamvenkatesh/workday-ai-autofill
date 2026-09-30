import { queryAll } from "./detector";
import { sleep } from "./observer";

export function pageHasUploadedFile(): boolean {
  const text = document.body?.innerText ?? "";
  if (/\.(pdf|docx|doc)\b/i.test(text) && /delete|remove|replace/i.test(text)) return true;
  return queryAll("[data-automation-id*='file'], [data-automation-id*='attachment']").some((el) =>
    /\.(pdf|docx|doc)\b/i.test(el.textContent ?? ""),
  );
}

export async function attachStoredResume(): Promise<boolean> {
  if (pageHasUploadedFile()) return true;

  const response = await chrome.runtime.sendMessage({ type: "GET_RESUME_FILE" });
  const stored = response?.result as { name: string; mimeType: string; base64: string } | null;
  if (!stored?.base64) {
    await chrome.runtime.sendMessage({
      type: "CONTENT_ERROR",
      message: "Drop your PDF into Resume/CV, then click Start autofill. Chrome blocks most scripted uploads.",
    });
    return false;
  }

  const file = fileFromBase64(stored);
  const dropped = await dropOnZone(file);
  const assigned = await assignToInput(file);
  await sleep(600);

  if (pageHasUploadedFile() || dropped || assigned) {
    await chrome.runtime.sendMessage({
      type: "CONTENT_ERROR",
      message: `Resume file offered to Workday: ${stored.name}. If the box is still empty, drop the PDF yourself.`,
    });
    return pageHasUploadedFile();
  }
  return false;
}

function fileFromBase64(stored: { name: string; mimeType: string; base64: string }): File {
  const bytes = Uint8Array.from(atob(stored.base64), (ch) => ch.charCodeAt(0));
  return new File([bytes], stored.name, { type: stored.mimeType || "application/pdf" });
}

async function assignToInput(file: File): Promise<boolean> {
  const input = queryAll("input[type='file']")[0] as HTMLInputElement | undefined;
  if (!input) return false;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
  input.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  return Boolean(input.files?.length);
}

async function dropOnZone(file: File): Promise<boolean> {
  const zone = queryAll("div, section, label").find((el) =>
    /drop files here|select files|upload a file/i.test((el.textContent ?? "").replace(/\s+/g, " ")),
  );
  if (!zone) return false;

  const transfer = new DataTransfer();
  transfer.items.add(file);
  const fire = (type: string) => {
    const event = new Event(type, { bubbles: true, cancelable: true, composed: true });
    Object.defineProperty(event, "dataTransfer", { value: transfer });
    zone.dispatchEvent(event);
  };
  fire("dragenter");
  fire("dragover");
  fire("drop");
  await sleep(200);
  return true;
}

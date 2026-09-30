import * as pdfjsLib from "pdfjs-dist";
import mammoth from "mammoth/mammoth.browser";

export { heuristicParse } from "./textParse";

export async function extractResumeText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  if (name.endsWith(".pdf") || file.type === "application/pdf") {
    return extractPdfText(buffer);
  }
  if (name.endsWith(".docx") || file.type.includes("wordprocessingml")) {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return result.value.trim();
  }
  if (name.endsWith(".txt") || file.type === "text/plain") {
    return new TextDecoder().decode(buffer);
  }
  throw new Error("Unsupported file type. Upload a PDF or DOCX resume.");
}

async function extractPdfText(data: ArrayBuffer): Promise<string> {
  pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
  const pdf = await pdfjsLib.getDocument({ data, useSystemFonts: true }).promise;
  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i += 1) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ");
    pages.push(line);
  }
  return pages.join("\n").replace(/\s+/g, " ").trim();
}

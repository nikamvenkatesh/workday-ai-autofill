import { defineManifest } from "@crxjs/vite-plugin";

export default defineManifest({
  manifest_version: 3,
  name: "Workday AI Autofill",
  version: "1.1.5",
  description:
    "AI-assisted Workday application autofill for a selected Workday posting.",
  icons: {
    "16": "icons/icon16.png",
    "48": "icons/icon48.png",
    "128": "icons/icon128.png",
  },
  action: {
    default_title: "Workday AI Autofill",
    default_popup: "src/popup/index.html",
    default_icon: {
      "16": "icons/icon16.png",
      "48": "icons/icon48.png",
      "128": "icons/icon128.png",
    },
  },
  side_panel: {
    default_path: "src/sidepanel/index.html",
  },
  background: {
    service_worker: "src/background/index.ts",
    type: "module",
  },
  permissions: ["storage", "sidePanel", "tabs", "activeTab", "scripting"],
  host_permissions: [
    "https://*.myworkdayjobs.com/*",
    "https://*.myworkday.com/*",
    "https://*.workday.com/*",
    "https://api.openai.com/*",
  ],
  content_scripts: [
    {
      matches: [
        "https://*.myworkdayjobs.com/*",
        "https://*.myworkday.com/*",
        "https://*.workday.com/*",
      ],
      js: ["src/content/index.ts"],
      run_at: "document_idle",
      all_frames: true,
    },
  ],
  web_accessible_resources: [
    {
      resources: ["pdf.worker.min.mjs", "icons/*"],
      matches: [
        "https://*.myworkdayjobs.com/*",
        "https://*.myworkday.com/*",
        "https://*.workday.com/*",
      ],
    },
  ],
});

# Workday AI Autofill

AI-assisted Chrome extension (Manifest V3) that parses a resume and autofills a Workday job application.

**Selected and tested form:** Target — Specialty Sales Team Leader, Fitchburg, WI, job ID `R0000475137`

<https://target.wd5.myworkdayjobs.com/en-US/targetcareers/job/6321-McKee-Rd%2C-Fitchburg%2CWI-53719-5017/Specialty-Sales-Team-Leader---Fitchburg--WI_R0000475137/apply/applyManually>

The assignment allows focusing on a single Workday posting. This build targets the Target
tenant (`target.wd5.myworkdayjobs.com`). Retargeting to another posting is a one-line change
to `ACTIVE` in [`src/config/target.ts`](src/config/target.ts) — a second Target posting and an
NVIDIA configuration are included there to show the path.

See [docs/LIMITATIONS.md](docs/LIMITATIONS.md) for why the Deli Production Expert posting on the
same tenant was not used: its flow adds a Take Assessment step that gates submission.

## What it does

1. Accepts a PDF or DOCX resume in the extension popup and extracts structured JSON (heuristics first, AI second).
2. Detects Workday multi-step forms on `*.myworkdayjobs.com` / `*.myworkday.com`.
3. Maps fields semantically (`Given Name` → first name), heuristics first, OpenAI second.
4. Autofills text inputs, dropdowns, dates, radio buttons, checkboxes and application questions.
5. Answers Yes/No compliance items from explicit user preferences (18+, work authorization, sponsorship).
6. Skips low-confidence EEO questions unless the field is required to continue.
7. Shows a side-panel review; submission stays behind an explicit user confirmation.

It does **not** store credentials, log you in, or bypass Workday authentication, SSO, MFA or CAPTCHA.

## Quick start

```bash
npm install
npm run build
```

Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → select `dist/`

Then open the extension popup and save an OpenAI API key.

- [docs/SETUP.md](docs/SETUP.md)
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/AI_STRATEGY.md](docs/AI_STRATEGY.md)
- [docs/LIMITATIONS.md](docs/LIMITATIONS.md)

## Demo flow

1. Save an OpenAI key in the popup.
2. Set preferences (18+, authorized to work; sponsorship off unless true).
3. Upload the resume PDF in the extension popup and check the extracted name, email and phone.
4. Open the target job → Apply / **Continue Application** → sign in yourself.
5. Click **Start autofill** on each form step.
6. **Manual (documented limitation):** attach the resume PDF on Workday's **My Experience → Resume/CV** step.
7. **Manual (documented limitation):** on **Self Identify**, set the date via the calendar widget.
8. Review each step, then confirm submission from the side panel.

## Architecture in one line

Four surfaces — popup, side panel, service worker, content script — over four modules:
**Parser → Mapper → Filler → Navigator**. See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Stack

Manifest V3 · TypeScript · React · Vite · CRXJS · pdf.js · mammoth · OpenAI

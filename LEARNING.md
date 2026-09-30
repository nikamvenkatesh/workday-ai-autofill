# LEARNING.md — understand this codebase well enough to defend it

This is your study guide. It explains Chrome extensions from zero, then walks every
file in this project and the reasoning behind it. Read it top to bottom once, then
use the "Interview questions" section at the end to test yourself.

**2,782 lines of TypeScript across 25 source files.** It is smaller than it looks.

---

## Part 1 — Chrome extensions from zero

### The one idea that explains everything

A web page and an extension live in **different worlds** and cannot freely touch each
other. Chrome deliberately isolates them. Almost every design decision in this project
exists to move data across that boundary safely.

There are four "surfaces" (places your code can run), and each is deliberately crippled
in a different way:

| Surface | Can touch the page DOM? | Can call Chrome APIs? | Lives for how long? |
|---|---|---|---|
| **Content script** | ✅ Yes — this is the only one | ⚠️ A small subset | As long as the tab |
| **Service worker** | ❌ Never | ✅ All of them | Sleeps after ~30s idle |
| **Popup** | ❌ Never | ✅ Yes | Dies the moment you click away |
| **Side panel** | ❌ Never | ✅ Yes | Stays open across navigation |

Read that table again. It explains the whole architecture:

- The **content script** is the only thing that can fill a Workday form — so all DOM code lives there.
- The **service worker** holds the OpenAI key and makes API calls — because the content script runs inside Workday's page and you never want a secret there.
- The **popup dies when you click away**, which is why it cannot drive a long autofill.
- The **side panel survives navigation**, which is why the live log and the submit confirmation live there.

They communicate only by **message passing**: `chrome.runtime.sendMessage(...)`.

### Manifest V3

`manifest.json` is the extension's config file. "MV3" is just the current version of
its format. We generate ours from [`manifest.config.ts`](manifest.config.ts) so it can
be typed and commented.

Key fields in ours:

```ts
permissions: ["storage", "sidePanel", "tabs", "activeTab", "scripting"]
host_permissions: ["https://*.myworkdayjobs.com/*", ... , "https://api.openai.com/*"]
content_scripts: [{ matches: [...workday hosts...], js: ["src/content/index.ts"],
                    run_at: "document_idle", all_frames: true }]
```

- `host_permissions` — the sites the extension may talk to. `*.myworkdayjobs.com`
  covers **every** Workday tenant, which is why retargeting from one company to
  another needs no manifest change.
- `run_at: "document_idle"` — inject after the page settles, not during load.
- `all_frames: true` — **important.** Workday renders parts of the application inside
  iframes. Without this, your content script never sees those fields.

### Loading it

```
chrome://extensions → Developer mode ON → Load unpacked → select dist/
```

After any code change: `npm run build`, then hit the reload icon on the extension card.
If the page was already open, **refresh the Workday tab too** — an old content script
stays injected until the page reloads. This trips up everyone once.

---

## Part 2 — The shape of this project

```
src/
├── config/target.ts        ← everything company-specific (we added this)
├── background/             ← service worker: the brain
│   ├── index.ts              orchestrator + message router
│   └── state.ts              single in-memory state object + pub/sub
├── content/                ← runs inside the Workday page
│   ├── index.ts              message router for the page side
│   ├── detector.ts           FIND fields
│   ├── filler.ts             FILL fields
│   ├── navigator.ts          CLICK Next / Submit, add repeatable rows
│   ├── observer.ts           wait for the SPA to settle
│   ├── resumeUpload.ts       best-effort resume attach
│   └── workdayFixes.ts       stubborn widgets that need bespoke handling
├── modules/                ← pure logic, no DOM
│   ├── parser.ts             PDF/DOCX → raw text
│   ├── textParse.ts          raw text → profile (regex heuristics)
│   ├── ai.ts                 OpenAI calls (parse + map)
│   ├── heuristics.ts         field label → value, without AI
│   └── mapper.ts             orchestrates heuristics-then-AI
├── lib/{fuzzy,storage}.ts  ← string matching, chrome.storage wrapper
├── popup/                  ← React UI: key, preferences, resume upload
├── sidepanel/              ← React UI: live log, review, confirm submit
└── types/                  ← shared TypeScript types
```

**The mental model is a pipeline:**

```
Parser → Mapper → Filler → Navigator
(text)   (decide)  (type)   (advance)
```

---

## Part 3 — The data flow, end to end

Trace one full step. This is the single most useful thing to be able to recite.

**1. You upload a resume** (popup)
`Popup.tsx` reads the file → `parser.ts` turns PDF/DOCX into raw text → sends
`PARSE_RESUME_TEXT` to the service worker.

**2. The resume becomes structured data** (service worker)
`ai.ts::aiParseResume` runs `gpt-4o-mini` in JSON mode. **`textParse.ts` runs first as
a fallback** so that if the API fails or there's no key, you still get name/email/phone
from regexes. Result is a `ResumeProfile`, saved to state.

**3. You open the Workday form and click Start**
The content script has already announced itself with `CONTENT_READY`. If it sees a
login screen it sends `LOGIN_REQUIRED` instead — the extension never touches auth.

**4. Fields get discovered** (content script)
`detector.ts::detectFields()` walks the DOM, and for each control works out a label,
a type, whether it's required, and its options. It stamps each element with a
`data-wdaf-id` attribute so it can be found again later — **this is the key trick**,
because after React re-renders you cannot rely on an element reference surviving.
Sends `FIELDS_DETECTED`.

**5. Fields get mapped to values** (service worker — `mapper.ts`)
This is the heart of the AI strategy:

```ts
const heuristic = fields.map(f => heuristicMapField(f, profile, preferences));
const remaining = fields.filter(f => no high-confidence heuristic plan);
const ai = remaining.length ? await aiMapFields(...) : [];
return mergePlans(heuristic, ai);
```

**Heuristics first, AI only for the leftovers.** Reasons: it's free, it's instant, and
it still works when the API is down. AI is the expensive fallback, not the default.

Output is a `FillPlan[]` — each with a value, a `confidence`, a `source`, and a
human-readable `reason` shown in the review panel.

**6. Values get typed in** (content script — `filler.ts`)
Sends `APPLY_FILL_PLAN`. Then `workdayFixes.ts` handles the stubborn widgets.
Then it **re-checks validation messages and retries once** — because Workday often
only reveals a conditional field after you answer the one above it.

**7. Advance** (`navigator.ts`)
`clickNext()` → wait for idle → re-scan. Repeat until the Review step.

**8. Submit — only on your explicit click** in the side panel.

---

## Part 4 — The five techniques that actually matter

These are what an interviewer will probe. Know them cold.

### 1. React-safe value setting

Workday's UI is React. Setting `input.value = "x"` does **nothing** — React's internal
state doesn't know, and the next render wipes it. You must go through the native
setter and fire a real event:

```js
const setter = Object.getOwnPropertyDescriptor(
  window.HTMLInputElement.prototype, "value").set;
setter.call(input, value);
input.dispatchEvent(new Event("input", { bubbles: true }));
```

This project also tries `document.execCommand("insertText", ...)` first, which
simulates real typing even more faithfully, and falls back to the native setter if the
value didn't stick (`valueMatches`).

### 2. Re-findable element IDs

```ts
const ATTR = "data-wdaf-id";
```

We stamp every discovered field with our own attribute, then look it up again with
`findByFieldId(id)` at fill time. If we held a JS reference instead, a React re-render
between detect and fill would leave us holding a detached node. This is the standard
answer to "how did you handle dynamic rendering?"

### 3. Waiting for a SPA to settle — `observer.ts`

```ts
const observer = new MutationObserver(bump);
// every mutation resets a timer; when the DOM is quiet for `quietMs`, resolve
```

Rather than `setTimeout(3000)` and hope, `waitForIdle()` watches for DOM mutations and
resolves once the page has been **quiet for 500ms**, with a 12s hard cap. This is the
difference between a flaky and a reliable automation.

`onSpaNavigation()` is the partner: Workday never does a full page load, so we monkey-patch
`history.pushState` / `replaceState` and poll `location.href` to notice step changes.

### 4. Heuristics before AI

Covered above. The interview framing: *deterministic where you can be, probabilistic
only where you must be.* It's cheaper, faster, and degrades gracefully.

### 5. Config-driven targeting — `src/config/target.ts`

**This is the part you changed, so know it best.**

Originally every company-specific string was scattered through `heuristics.ts`,
`workdayFixes.ts`, `Popup.tsx`, `state.ts` and the manifest. We pulled all of it into
one `TargetConfig` object:

```ts
export type QuestionRule = {
  id: string;
  labels: string[];                    // for the heuristic mapper
  match: RegExp;                       // for the in-page DOM pass
  answer: "Yes" | "No" | ((p: UserPreferences) => "Yes" | "No");
  source: FillPlan["source"];
  reason: string;                      // shown to the user before submit
};
export const ACTIVE: TargetConfig = TARGET_DELI;
```

Both the mapper and the DOM pass now iterate `ACTIVE.questions`, so the two can never
drift apart. Retargeting to NVIDIA is changing `ACTIVE` to `NVIDIA_HPC` — one line.

This directly satisfies the assignment constraint *"must adapt to UI changes beyond
hardcoded selectors."*

---

## Part 5 — File-by-file

| File | Lines | What to say about it |
|---|---|---|
| `config/target.ts` | ~170 | Single source of truth for company-specific data. One-line retarget. |
| `content/workdayFixes.ts` | 348 | Biggest file. Bespoke handling for Workday's custom widgets — two-level "How did you hear about us?" prompts, masked date inputs, Yes/No comboboxes that aren't `<select>`. |
| `modules/heuristics.ts` | ~280 | Label → value without AI. Also owns `isEeoField` and `shouldSkipField` (never fill SSN, password, captcha). |
| `content/detector.ts` | 272 | Finds fields, derives labels, stamps `data-wdaf-id`, finds Next/Submit, reads validation errors. |
| `content/filler.ts` | 269 | Types values in. Separate paths for text, select, combobox, radio, checkbox, date. |
| `background/index.ts` | 267 | Message router and orchestrator. Owns the OpenAI key. |
| `popup/Popup.tsx` | 253 | Key entry, preferences, resume upload, profile correction. |
| `modules/ai.ts` | 158 | Two prompts, JSON mode, `temperature: 0.1`. |
| `content/index.ts` | 146 | Page-side router: scan → fill → next → submit. |
| `sidepanel/SidePanel.tsx` | 107 | Live log + review + the submit confirmation. |
| `background/state.ts` | 79 | One state object, pub/sub via `emit()`. |
| `content/resumeUpload.ts` | 74 | Best-effort resume attach (see limitations). |
| `types/field.ts` | 74 | `FormField`, `FillPlan`, `ReviewSummary`, `SessionState`. |
| `content/navigator.ts` | 72 | Next/Submit, plus `ensureExperienceRows` for repeatable sections. |
| `content/observer.ts` | 64 | `waitForIdle`, `onSpaNavigation`. |
| `lib/fuzzy.ts` | 44 | `normalize`, `labelMatches`, `bestOptionMatch`. |
| `modules/textParse.ts` | 37 | Regex fallback parser. |
| `modules/parser.ts` | 35 | pdf.js + mammoth → raw text. |
| `modules/mapper.ts` | 28 | The heuristics-then-AI orchestration. |

---

## Part 6 — Honest limitations (know why, not just what)

1. **File upload cannot be automated.** Browsers forbid programmatically putting a file
   into an `<input type=file>` for security — otherwise any page could steal your files.
   The resume attach step is manual. Every entrant hits this.
2. **Masked date inputs** produce garbage like `08/DD/2008` when typed into. Drive the
   calendar widget instead.
3. **Two-level dropdowns** need parent *and* child selected, or the step won't validate.
4. **Extension reload requires a page refresh** — the old content script stays injected.
5. **We deliberately don't answer** salary, criminal history, SSN, or optional EEO.
   Refusing to guess is a feature; `shouldSkipField` enforces it.

---

## Part 7 — Interview questions to test yourself

Answer out loud before reading Part 3–4 again.

1. Why can't the content script call the OpenAI API directly? *(secret exposure inside a third-party page)*
2. Why a side panel and not the popup for the live log? *(popup dies on blur)*
3. Why does setting `.value` not work on Workday? *(React's synthetic state)*
4. How do you re-find an element after a re-render? *(`data-wdaf-id`)*
5. Why `MutationObserver` instead of `setTimeout`? *(settle-detection vs guessing)*
6. Why heuristics before AI? *(cost, latency, graceful degradation)*
7. How would you retarget this at a new company? *(`ACTIVE` in `config/target.ts`)*
8. Why `all_frames: true`? *(Workday uses iframes)*
9. What happens if the OpenAI key is missing? *(`textParse.ts` fallback; heuristics still fill contact fields)*
10. How do you avoid overwriting data Workday pre-filled? *(`currentValue` is sent to the model, and the prompt forbids overwriting unless clearly better)*
11. Why does `fillCurrentStep` run `applyKnownWorkdayAnswers()` twice? *(conditional fields appear only after the field above is answered)*
12. What stops it from submitting by itself? *(submit is only reachable via `CONFIRM_SUBMIT` from the side panel)*

---

## Part 8 — What's left to do

- [x] Walk a Target form manually and record every field label and type (done 30 Sep, Team Leader R0000475137)
- [x] Update `ACTIVE.questions` in `config/target.ts` to match the real Target questions
- [ ] End-to-end test run
- [ ] Rewrite `docs/*.md` in your own words
- [ ] Demo video
- [ ] Push to your own GitHub, state the selected form in the submission

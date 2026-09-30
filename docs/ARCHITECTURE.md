# Architecture

This is a Manifest V3 extension. The shape of it is driven almost entirely by
one constraint: **only a content script can touch the page's DOM, and a content
script is the last place you want to put an API key.** Everything else follows
from that.

```
Popup / Side panel
        │
        ▼
Service worker  (holds the key, calls OpenAI, owns session state)
        │
        ▼
Content script on *.myworkdayjobs.com
   Detector → Mapper (via the worker) → Filler → Navigator
```

## The four surfaces

| Surface | What it does | Why it has to be this one |
|---|---|---|
| Popup | API key, preferences, resume upload, parse preview | Needs Chrome APIs, doesn't need the DOM |
| Side panel | Live log, last step's mapping, the confirm-submit gate | Survives page navigation; the popup does not |
| Service worker | Owns the key, session state, runs the mapping | Can call OpenAI without exposing the key to Workday's page |
| Content script | Finds fields, fills them, clicks through steps | The only thing that can see the DOM |

The side panel choice matters more than it looks. A popup closes the instant you
click anywhere else, which is useless when the thing you are watching takes a
couple of minutes and navigates between steps. The side panel stays put.

## The modules

### Parser — `src/modules/parser.ts`

pdf.js for PDFs, mammoth for DOCX, and a plain-text path for `.txt`. The pdf.js
worker is copied into `public/` and loaded through `chrome.runtime.getURL`,
because a content-script context can't fetch it from a CDN.

Then `src/modules/ai.ts` turns that raw text into structured JSON with
`gpt-4o-mini` in JSON mode. There's a regex fallback in `textParse.ts` that runs
first regardless, so if the API call fails you still get an email, a phone
number, the LinkedIn/GitHub links and a decent guess at the name.

### Mapper — `src/modules/mapper.ts` and `heuristics.ts`

Heuristics run first and only the leftovers go to the model:

```ts
const heuristic = fields.map(f => heuristicMapField(f, profile, preferences));
const remaining = fields.filter(f => no high-confidence heuristic plan);
const ai = remaining.length ? await aiMapFields(...) : [];
return mergePlans(heuristic, ai);
```

Cheaper, faster, and it degrades gracefully when the API is down. Anything the
model returns at low confidence, plus anything EEO-ish, is marked `skip` and
surfaced in the review panel rather than typed into the form.

### Filler — `src/content/filler.ts`

Two things here are worth knowing.

First, Workday's UI is React, so assigning `input.value = "x"` does nothing
useful — React's internal state never hears about it and the next render throws
your value away. The filler goes through the native property setter and
dispatches a real `input` event, and tries `document.execCommand("insertText")`
first because that simulates actual typing more faithfully. There's a
`valueMatches` check afterwards to catch the cases where it still didn't stick.

Second, fields are found again by a `data-wdaf-id` attribute the detector stamps
on them, not by holding a JS reference. Between discovering a field and filling
it, React may have re-rendered and thrown away the node you were holding. An
attribute survives that; an object reference doesn't.

### Navigator — `src/content/navigator.ts` and `observer.ts`

`waitForIdle()` uses a `MutationObserver` and resolves once the DOM has been
quiet for half a second, with a hard cap so it can't hang forever. This replaced
fixed `setTimeout` waits and is the single biggest reliability win in the
project — Workday's step transitions take wildly different amounts of time and
guessing a number never worked.

`onSpaNavigation()` patches `history.pushState` / `replaceState` and polls the
URL, because Workday never does a real page load and there's no navigation event
to listen for otherwise.

The navigator also adds Experience and Education rows when the resume has more
entries than the form starts with, and it only clicks Submit when the side panel
sends `CONFIRM_SUBMIT`.

## Company-specific things live in one file

`src/config/target.ts` holds the company name, the posting details, the two-level
"How did you hear about us?" options, and every company-specific application
question as a declarative rule. Retargeting the extension at a different posting
is changing `ACTIVE` at the bottom of that file.

That mattered here for a practical reason as well as a tidiness one: the mapper
and the in-page DOM pass both need to answer the same questions, and when those
were two separate hardcoded lists they drifted. Now they iterate the same array.

## Why there are barely any CSS selectors

Workday's generated class names change between tenants and releases, so the
detector leans on things that don't:

- `data-automation-id`
- accessible names — `aria-label`, `aria-labelledby`, a real `<label>`
- roles — `combobox`, `option`, `radio`
- shadow-DOM traversal where Workday uses it

And the AI mapping works off **labels**, not CSS paths, so a layout change
doesn't mean a code change.

## State machine

```
idle → parsing → ready → waiting_login | filling → review → submitting → submitted
```

The submit button in the side panel is disabled until the phase reaches
`review`. There is no code path that submits without that click.

## Storage

- API key and preferences: `chrome.storage.local`
- Parsed resume: `chrome.storage.session`, so it's gone when the browser closes
- Workday credentials: never touched, never stored

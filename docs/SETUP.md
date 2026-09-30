# Setup

## What you need

- Chrome (or any Chromium browser) with Developer Mode available
- Node.js 20 or newer
- An OpenAI API key

The key is optional in the sense that the extension still runs without one — the
heuristic layer fills contact details, the preference-driven questions and the
obvious name/address fields on its own. But the AI mapping is what handles the
odd, wordy questions, so without a key you will be finishing more of the form by
hand.

## Build it

```bash
npm install
npm run build
```

That produces `dist/`. Load it into Chrome:

1. Go to `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. **Load unpacked**
4. Pick the `dist/` folder

Check the extension's **Site access** afterwards and make sure these are allowed:

- `https://*.myworkdayjobs.com/*`
- `https://*.myworkday.com/*`
- `https://api.openai.com/*`

One thing that will catch you out: after every `npm run build` you have to hit
**Reload** on the extension card *and* press F5 on the Workday tab. The old
content script stays injected in an already-open page until you reload it, so
you end up debugging a version of the code that isn't running any more. I lost a
while to this before it clicked.

## First run

1. Pin the extension so you can get at the popup quickly.
2. Open the popup, paste your OpenAI key, hit **Save key**.
3. Set the Yes/No preferences — over 18, authorised to work, whether you need
   sponsorship. These drive the compliance questions later, and the extension
   will not guess at them.
4. Upload your resume (PDF or DOCX). Once it parses, check the name, email and
   phone it pulled out. Whatever you correct here wins over whatever the model
   extracted.

## Running it against the selected form

The target posting is:

**Target — Specialty Sales Team Leader, Fitchburg, WI** (`R0000475137`)
https://target.wd5.myworkdayjobs.com/en-US/targetcareers/job/6321-McKee-Rd%2C-Fitchburg%2CWI-53719-5017/Specialty-Sales-Team-Leader---Fitchburg--WI_R0000475137/apply/applyManually

1. Open the posting and click **Apply** (or **Continue Application** if you
   already have a draft sitting there).
2. Sign in yourself. If Workday offers "Apply with LinkedIn", don't — pick
   **Apply Manually**, otherwise you get a different form.
3. Wait until you can actually see form fields rather than the job description,
   then click **Start autofill**.
4. On **My Experience** you will need to attach the resume PDF by hand with
   **Select files**. This is a browser security limitation, not a bug — see
   LIMITATIONS.md.
5. Keep going step by step. The side panel logs what it filled and what it
   skipped as it goes.
6. At the Review step the extension stops. Submission only happens when you
   click confirm in the side panel.

## Where your data lives

- The parsed resume goes into `chrome.storage.session`, so it disappears when
  you close the browser.
- The OpenAI key goes into `chrome.storage.local` and never leaves your machine
  except in calls to OpenAI itself, which are made from the service worker.
- No Workday credentials are stored or read at any point.
- Don't commit your key. `.env` is gitignored, and the key isn't meant to live
  in a file anyway — it goes in the popup.

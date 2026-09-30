# Limitations

## The form this was built and tested against

- **Company:** Target
- **Role:** Specialty Sales Team Leader — Fitchburg, WI
- **Job ID:** `R0000475137`
- **Tenant:** `target.wd5.myworkdayjobs.com`
- **URL:** https://target.wd5.myworkdayjobs.com/en-US/targetcareers/job/6321-McKee-Rd%2C-Fitchburg%2CWI-53719-5017/Specialty-Sales-Team-Leader---Fitchburg--WI_R0000475137/apply/applyManually

The brief allows picking one of the four listed postings and focusing on it, so
that is what I did.

I started on the Deli Production Expert posting on the same tenant, because it
has fewer application questions. I switched away from it after finding that its
flow inserts a **Take Assessment** step between Voluntary Disclosures and
Review. That step gates submission behind a test the extension has no business
completing, so the end-to-end flow can't be demonstrated on it. The Team Leader
posting has five steps and no assessment, at the cost of about five extra
leadership questions, which are declared in `src/config/target.ts`. Switching
back is a one-line change to `ACTIVE`.

## Authentication

The extension does not store credentials and does not touch sign-in, SSO, MFA or
CAPTCHA. It detects a login screen and stops. You sign in yourself, and it picks
up once you're on the form. That's a deliberate constraint from the brief and
also the only defensible design.

## The resume upload has to be manual

Browsers do not let a script put a file into an `<input type="file">`. If they
did, any page you visited could read files off your machine. So the **My
Experience → Resume/CV** step needs you to click **Select files** and pick the
PDF yourself.

The extension still parses the resume — that's how every other field gets
filled — it just can't hand the file to Workday's dropzone. There's a
best-effort attempt in `resumeUpload.ts` for the cases where Workday exposes a
drop target that accepts a synthesised `DataTransfer`, but it should not be
relied on.

## Date fields with input masks

Workday's masked date inputs consume keystrokes rather than accepting a value,
and typing into them can leave something like `08/DD/2008` — a half-filled mask
that validates as an error. The disability form's CC-305 date is the worst
offender because its label is generic enough that a naive mapper will try to put
a resume year in it.

`fillPlaceholderDates` types digit by digit with `execCommand("insertText")`,
which works most of the time. When it doesn't, set the date using the calendar
widget by hand.

## Two-level dropdowns

"How Did You Hear About Us?" is not a normal select. You click a category —
Job Boards, Social Media, Corporate Website — and then a child option inside it.
Selecting only the category leaves the field invalid, and Workday will not tell
you that until you try to continue.

This is handled in the in-page pass rather than the mapper, because a single
value written into the input never commits. The categories and children are
configured in `src/config/target.ts`.

## Questions it leaves alone

By design, it does not fill:

- Salary or compensation expectations
- Criminal history
- SSN or national ID
- Optional EEO questions, when preferences say to skip them

Required voluntary disclosures — gender and race are both mandatory on this
tenant — are answered with "I do not wish to answer" rather than a guess.

## Extension reloads

Rebuild the extension and the already-injected content script in an open tab
keeps running the old code. Reload the extension *and* press F5 on the Workday
tab. If the side panel starts reporting that it can't reach the page, this is
almost always why.

After a successful submit, Workday tears down the page and the side panel may
show a connection error. The submission has already gone through at that point;
it's cosmetic.

## Conditional fields need a second pass

Some fields only appear once you've answered the one above them. `fillCurrentStep`
runs the known-answers pass twice with a short wait in between, and re-checks
validation messages before moving on. It's a pragmatic fix rather than an
elegant one, but it handles the common case.

## AI dependency

Without an OpenAI key the heuristic layer still fills contact details, the
preference-driven compliance questions and the configured application questions.
What you lose is the mapping for unusual or wordy labels that no heuristic
covers. It degrades rather than breaks.

## Scope

Only the Target tenant has been tested. The core engine is company-agnostic and
an NVIDIA configuration is included in `src/config/target.ts` to show the
retarget path, but I have not run the extension against it end to end and would
expect its question set to need work.

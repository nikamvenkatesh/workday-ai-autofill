# AI strategy

AI does two jobs here: turning a resume into structured data, and deciding what
goes in a field when the label isn't obvious. Both sit behind a heuristic layer
that runs first, so a missing key or a failed request degrades the extension
rather than stopping it.

That ordering is the main design decision in the project, so it's worth saying
why. Calling a model for "Email Address" is slower, costs money, and can fail —
for a field a regex answers perfectly. The model earns its place on the things a
regex can't touch, like *"Do you have an employment agreement or any
restrictions with your current or past employer, such as a non-compete,
non-solicitation, or confidentiality agreement?"*

## Resume understanding

**Model:** `gpt-4o-mini`
**Runs:** once, when you upload
**In:** raw resume text, truncated to 18k characters
**Out:** a `ResumeProfile` — name, contact, location, links, experience,
education, skills, certifications

`heuristicParse()` runs first and always. It pulls the email, phone, LinkedIn and
GitHub links and takes a reasonable guess at the name from the first line. If
there's no API key, or the call fails, that's what you get, and it's enough to
fill the My Information step.

The popup shows the extracted name, email and phone and lets you correct them
before anything is filled. Those corrections are treated as ground truth and
override the model.

## Field mapping

**Model:** `gpt-4o`
**Runs:** once per form step, on the fields heuristics didn't already answer with
high confidence
**In:** the resume JSON, the user's preferences, and for each visible field its
id, label, type, required flag, options and current value

**Out:** a fill plan per field:

```json
{
  "fieldId": "legalNameSection_firstName",
  "label": "Given Name",
  "value": "Ada",
  "confidence": "high",
  "source": "resume",
  "reason": "Mapped to resume first name"
}
```

The `reason` field isn't decoration — it's what the review panel shows the user
so they can see why something was filled before they approve a submission.

### Rules the model is given

- Use the `fieldId` values exactly as provided.
- For a dropdown or radio, the value has to be one of the options listed, or skip.
- Skip EEO, demographic and voluntary identity questions unless preferences
  clearly answer them.
- Don't invent visa, salary or criminal-history answers.
- Don't overwrite a non-empty `currentValue` unless the mapped value is clearly
  better.
- Low confidence means skip, and it surfaces for review.

## The heuristic layer

No tokens, no latency, no failure mode:

| Label looks like | Comes from |
|---|---|
| given / first / legal first name | `resume.name.first` |
| family / last / surname | `resume.name.last` |
| email, phone, city, postal code, LinkedIn, GitHub | resume |
| over 18, authorised to work, sponsorship | user preferences |
| most recent job title / employer / school | first experience or education entry |
| company-specific application questions | `src/config/target.ts` |

That last row is worth expanding on. Each rule in the config carries a
*preference-ordered list* of candidate answers rather than a single string, and
the filler takes the first one that actually matches an option in the live
dropdown. Target's experience questions offer `Yes - Under 1 year`,
`Yes - 1-3 years`, `Yes - 3+ years`, `No, but willing to learn` and `No`, where
another tenant would offer a plain Yes/No. One rule covers both.

## Questions it deliberately won't answer

The brief says not every question needs answering, particularly ones that can't
be reliably inferred. I took that seriously rather than filling everything for
the sake of a higher completion count.

It answers confidently where preferences or the resume genuinely settle it:
previously employed, relationship to an employee, sponsorship, right to work,
contractor history, agency referral.

It answers at medium confidence, flagged for review, where a defensible default
exists but the resume doesn't prove it: the retail experience questions, weekday
availability, weekend availability.

It refuses outright on salary, criminal history, SSN and national ID —
`shouldSkipField` blocks those regardless of what the model says.

For the voluntary disclosures, gender and race are *required* on this tenant, so
skipping them isn't an option if you want to reach Review. Rather than inventing
demographics, it selects "I do not wish to answer". Declining is a real, honest
answer to a voluntary question.

One specific trap: the disability form's **Date** field has a generic label and
a mask that only accepts part of what you type. It must not be mapped from a
resume year — see LIMITATIONS.md.

## Prompt hygiene

- JSON mode, both calls
- `temperature: 0.1` — this is extraction and matching, not writing
- No chain-of-thought; it costs tokens and adds nothing for a mapping task
- The key is read only inside the service worker, never in the content script

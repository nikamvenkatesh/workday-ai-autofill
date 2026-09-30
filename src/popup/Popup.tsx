import { useEffect, useMemo, useState } from "react";
import type { SessionState } from "../types/field";
import type { ResumeProfile, UserPreferences } from "../types/resume";
import { DEFAULT_PREFERENCES } from "../types/resume";
import { extractResumeText } from "../modules/parser";

import { ACTIVE } from "../config/target";
export function Popup() {
  const [state, setState] = useState<SessionState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");

  const refresh = async () => {
    const res = await chrome.runtime.sendMessage({ type: "GET_STATE" });
    setState(res.result as SessionState);
  };

  useEffect(() => {
    void refresh();
    const onMessage = (msg: { type?: string; state?: SessionState }) => {
      if (msg.type === "STATE" && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const profile = state?.profile;
  const prefs = state?.preferences ?? DEFAULT_PREFERENCES;

  const canStart = Boolean(profile?.email || profile?.name.first) && !busy;

  const status = useMemo(() => {
    switch (state?.phase) {
      case "parsing": return "Parsing resume…";
      case "ready": return `Resume ready. Open the ${ACTIVE.company} Apply page, then start.`;
      case "waiting_login": return "Sign in to Workday, then start again.";
      case "filling": return `Filling: ${state.currentStep || "detecting step"}`;
      case "review": return "Review reached — confirm submit in the side panel.";
      case "submitted": return "Submitted after your confirmation.";
      case "error": return state.lastError || "Something went wrong.";
      default: return "Upload a resume to begin.";
    }
  }, [state]);

  async function saveKey() {
    await chrome.runtime.sendMessage({ type: "SAVE_API_KEY", key: apiKey });
    setApiKey("");
    await refresh();
  }

  async function savePrefs(next: UserPreferences) {
    await chrome.runtime.sendMessage({ type: "SAVE_PREFERENCES", preferences: next });
  }

  async function onFile(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    setFileName(file.name);
    try {
      const text = await extractResumeText(file);
      if (!text || text.length < 20) throw new Error("Could not extract text from that file.");
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      await chrome.runtime.sendMessage({
        type: "PARSE_RESUME_TEXT",
        text,
        fileName: file.name,
        fileBase64: btoa(binary),
        mimeType: file.type || "application/pdf",
      });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function updateProfile(partial: Partial<ResumeProfile>) {
    if (!profile) return;
    const next = { ...profile, ...partial };
    await chrome.runtime.sendMessage({ type: "UPDATE_PROFILE", profile: next });
  }

  async function start() {
    setBusy(true);
    setError("");
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.windowId != null) {
        try {
          await chrome.sidePanel.open({ windowId: tab.windowId });
        } catch {
          /* side panel is optional; autofill can still run */
        }
      }
      const res = await chrome.runtime.sendMessage({ type: "START_AUTOFILL" });
      if (res && res.ok === false) {
        throw new Error(String(res.error || "Autofill failed to start."));
      }
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wrap">
      <header className="brand">
        <div className="mark">H</div>
        <div>
          <h1 style={{ fontSize: 16 }}>Workday AI Autofill</h1>
          <div className="tiny">AI-assisted application filling</div>
        </div>
      </header>

      <section className="card stack">
        <div className="between">
          <strong>Selected target</strong>
          <span className="chip">{ACTIVE.company}</span>
        </div>
        <p className="tiny">
          {ACTIVE.jobTitle} ({ACTIVE.jobId}). Keep the apply-form tab focused when you start.
        </p>
        <p>{status}</p>
        {error ? <p style={{ color: "var(--danger)", margin: 0 }}>{error}</p> : null}
        {state?.lastError ? <p className="tiny" style={{ color: "var(--danger)" }}>{state.lastError}</p> : null}
      </section>

      <section className="card stack">
        <div className="between">
          <strong>OpenAI key</strong>
          <span className={`chip ${state?.hasApiKey ? "" : "warn"}`}>
            {state?.hasApiKey ? "Saved on this device" : "Optional — heuristics only"}
          </span>
        </div>
        <label className="field">
          API key
          <input
            type="password"
            value={apiKey}
            placeholder={state?.hasApiKey ? "•••• stored locally" : "sk-…"}
            onChange={(e) => setApiKey(e.target.value)}
          />
        </label>
        <button className="btn secondary" onClick={() => void saveKey()} disabled={!apiKey.trim()}>
          Save key
        </button>
      </section>

      <section className="card stack">
        <strong>Preferences used for Yes/No questions</strong>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.isOver18}
            onChange={(e) => void savePrefs({ ...prefs, isOver18: e.target.checked })}
          />
          I am 18 or older
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.authorizedToWork}
            onChange={(e) => void savePrefs({ ...prefs, authorizedToWork: e.target.checked })}
          />
          Authorized to work in the posting country
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.requireSponsorship}
            onChange={(e) => void savePrefs({ ...prefs, requireSponsorship: e.target.checked })}
          />
          I will require visa sponsorship
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={prefs.skipEEO}
            onChange={(e) => void savePrefs({ ...prefs, skipEEO: e.target.checked })}
          />
          Skip voluntary / EEO questions
        </label>
      </section>

      <section className="card stack">
        <strong>Resume</strong>
        <label className="drop">
          <input
            type="file"
            accept=".pdf,.docx,.txt,application/pdf"
            hidden
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
          <strong>{busy ? "Working…" : "Upload PDF or DOCX"}</strong>
          <span className="tiny">{fileName || "Parsed locally, then structured with AI if a key is set."}</span>
        </label>
        {error ? <p className="tiny" style={{ color: "var(--danger)" }}>{error}</p> : null}

        {profile ? (
          <div className="stack">
            <div className="grid2">
              <label className="field">
                First name
                <input
                  value={profile.name.first}
                  onChange={(e) => void updateProfile({
                    name: { ...profile.name, first: e.target.value, full: `${e.target.value} ${profile.name.last}`.trim() },
                  })}
                />
              </label>
              <label className="field">
                Last name
                <input
                  value={profile.name.last}
                  onChange={(e) => void updateProfile({
                    name: { ...profile.name, last: e.target.value, full: `${profile.name.first} ${e.target.value}`.trim() },
                  })}
                />
              </label>
            </div>
            <label className="field">
              Email
              <input value={profile.email} onChange={(e) => void updateProfile({ email: e.target.value })} />
            </label>
            <label className="field">
              Phone
              <input value={profile.phone} onChange={(e) => void updateProfile({ phone: e.target.value })} />
            </label>
            <p className="tiny">
              {profile.experience.length} jobs · {profile.education.length} schools · {profile.skills.length} skills
            </p>
          </div>
        ) : null}
      </section>

      <div className="stack">
        <button className="btn" disabled={!canStart} onClick={() => void start()}>
          Start autofill
        </button>
        <button className="btn ghost" onClick={() => void chrome.runtime.sendMessage({ type: "RESET" })}>
          Reset run
        </button>
      </div>
    </div>
  );
}

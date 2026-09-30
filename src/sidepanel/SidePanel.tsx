import { useEffect, useState } from "react";
import type { SessionState } from "../types/field";

export function SidePanel() {
  const [state, setState] = useState<SessionState | null>(null);

  useEffect(() => {
    void chrome.runtime.sendMessage({ type: "GET_STATE" }).then((res) => {
      setState(res.result as SessionState);
    });
    const onMessage = (msg: { type?: string; state?: SessionState }) => {
      if (msg.type === "STATE" && msg.state) setState(msg.state);
    };
    chrome.runtime.onMessage.addListener(onMessage);
    return () => chrome.runtime.onMessage.removeListener(onMessage);
  }, []);

  const review = state?.lastReview;
  const filledOk = review?.filled.filter((f) => f.ok && f.value).length ?? 0;
  const attempted = review?.filled.length ?? 0;
  const skipped = review?.skipped.length ?? 0;
  const canSubmit = state?.phase === "review";

  async function confirm() {
    await chrome.runtime.sendMessage({ type: "CONFIRM_SUBMIT" });
  }

  return (
    <div className="wrap">
      <header className="brand">
        <div className="mark">H</div>
        <div>
          <h1 style={{ fontSize: 16 }}>Live review</h1>
          <div className="tiny">{state?.selectedCompany} · {state?.selectedJob}</div>
        </div>
      </header>

      <section className="card stack">
        <div className="between">
          <strong>{state?.currentStep || "Waiting for Workday"}</strong>
          <span className={`chip ${state?.phase === "error" ? "danger" : ""}`}>{state?.phase ?? "idle"}</span>
        </div>
        <div className="progress">
          <span style={{ width: `${attempted ? Math.round((filledOk / Math.max(attempted, 1)) * 100) : 8}%` }} />
        </div>
        <p className="tiny">
          {filledOk} filled · {skipped} skipped · {review?.errors.length ?? 0} errors
        </p>
        {state?.lastError ? <p style={{ color: "var(--danger)" }}>{state.lastError}</p> : null}
      </section>

      {review ? (
        <section className="card stack">
          <strong>Last step mapping</strong>
          <table>
            <thead>
              <tr>
                <th>Field</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {review.filled.filter((f) => f.value).slice(0, 20).map((row) => (
                <tr key={row.fieldId}>
                  <td>{row.label}</td>
                  <td>{row.ok ? row.value : row.error}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {review.skipped.length ? (
            <p className="tiny">
              Skipped: {review.skipped.map((s) => s.label).slice(0, 8).join(", ")}
              {review.skipped.length > 8 ? "…" : ""}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="card stack">
        <strong>Activity</strong>
        <div className="log">
          {(state?.logs ?? []).slice().reverse().map((entry) => (
            <div key={entry.at + entry.message} className={entry.level}>
              {new Date(entry.at).toLocaleTimeString()} · {entry.message}
            </div>
          ))}
        </div>
      </section>

      <section className="card stack">
        <p>
          Submit stays locked until you confirm. The extension never bypasses Workday sign-in
          and does not invent EEO answers.
        </p>
        <button className="btn" disabled={!canSubmit} onClick={() => void confirm()}>
          Confirm submit
        </button>
        {!canSubmit ? (
          <p className="tiny">Enabled only on the Workday Review step after autofill completes.</p>
        ) : (
          <p className="tiny">This clicks Workday’s Submit button on the active tab.</p>
        )}
      </section>
    </div>
  );
}

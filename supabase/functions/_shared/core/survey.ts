// Post-purchase survey: validation of untrusted answers against the active question set.

export interface SurveyQuestion {
  key: string;
  prompt: string;
  kind: "yes_no" | "single_choice";
  options: { value: string; label: string }[];
}

export const YES_NO_OPTIONS = [{ value: "yes", label: "Yes" }, { value: "no", label: "No" }];

export function optionsFor(q: SurveyQuestion) {
  return q.kind === "yes_no" ? YES_NO_OPTIONS : q.options;
}

/** Returns only valid answers; every active question must be answered (a "skip" is not an answer). */
export function validateAnswers(questions: SurveyQuestion[], raw: unknown): { ok: true; answers: Record<string, string> } | { ok: false; missing: string[] } {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const answers: Record<string, string> = {};
  const missing: string[] = [];
  for (const q of questions) {
    const v = input[q.key];
    if (typeof v === "string" && optionsFor(q).some((o) => o.value === v)) answers[q.key] = v;
    else missing.push(q.key);
  }
  return missing.length ? { ok: false, missing } : { ok: true, answers };
}

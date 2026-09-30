export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&amp;/g, "and")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function includesNormalized(haystack: string, needle: string): boolean {
  return normalize(haystack).includes(normalize(needle));
}

export function tokenOverlap(a: string, b: string): number {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.max(ta.size, tb.size);
}

export function bestOptionMatch(target: string, options: string[]): string | null {
  if (!options.length) return null;
  const nTarget = normalize(target);
  const exact = options.find((o) => normalize(o) === nTarget);
  if (exact) return exact;

  const contains = options.find(
    (o) => normalize(o).includes(nTarget) || nTarget.includes(normalize(o)),
  );
  if (contains) return contains;

  let best: { option: string; score: number } | null = null;
  for (const option of options) {
    const score = tokenOverlap(target, option);
    if (!best || score > best.score) best = { option, score };
  }
  return best && best.score >= 0.4 ? best.option : null;
}

export function labelMatches(label: string, patterns: string[]): boolean {
  const n = normalize(label);
  return patterns.some((p) => n.includes(normalize(p)));
}

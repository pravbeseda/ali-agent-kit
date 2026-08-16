// Shared between ali-instructions-global and ali-instructions-project.
// Exact and near-duplicate rule lines across instruction files. Hints for the
// model, not verdicts: the rubric decides what a duplicate is.

const STOP = new Set(['a', 'an', 'the', 'to', 'of', 'in', 'on', 'for', 'and', 'or', 'is', 'are', 'be', 'it', 'this', 'that', 'with', 'as', 'at', 'by', 'do', 'not', "don't", 'please']);

/** Split a markdown file into candidate rule lines (headings, fences and blanks skipped). */
export function ruleLines(text, file = '') {
  const out = [];
  let inFence = false;
  let section = '';
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const heading = /^(#{1,6})\s+(.*)$/.exec(line);
    if (heading) {
      section = heading[2].trim();
      return;
    }
    if (!line.trim() || /^<!--/.test(line.trim()) || /^---\s*$/.test(line)) return;
    const stripped = line.replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '').replace(/^\s*>\s?/, '').trim();
    if (!stripped) return;
    out.push({ file, line: index + 1, section, text: stripped, norm: normalize(stripped) });
  });
  return out;
}

export function normalize(text) {
  return text
    .toLowerCase()
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*|__|\*|_/g, '')
    .replace(/[^\p{L}\p{N}\s/._-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:!?]+$/, '');
}

function tokensOf(norm) {
  return new Set(norm.split(' ').filter((t) => t && !STOP.has(t)));
}

/** Dice coefficient over token sets. */
export function similarity(a, b) {
  const ta = tokensOf(a);
  const tb = tokensOf(b);
  if (!ta.size || !tb.size) return 0;
  let common = 0;
  for (const t of ta) if (tb.has(t)) common++;
  return (2 * common) / (ta.size + tb.size);
}

/**
 * findDuplicates(lines, { threshold }) → { exact: [[line, line, ...]], near: [{a, b, score}] }
 * `lines` from ruleLines(); exact groups are by normalised text, near pairs by Dice ≥ threshold.
 */
export function findDuplicates(lines, { threshold = 0.7 } = {}) {
  const byNorm = new Map();
  for (const l of lines) (byNorm.get(l.norm) ?? byNorm.set(l.norm, []).get(l.norm)).push(l);
  const exact = [...byNorm.values()].filter((group) => group.length > 1);

  const reps = [...byNorm.entries()].map(([norm, group]) => ({ norm, rep: group[0] }));
  const near = [];
  for (let i = 0; i < reps.length; i++) {
    for (let j = i + 1; j < reps.length; j++) {
      const score = similarity(reps[i].norm, reps[j].norm);
      if (score >= threshold) near.push({ a: reps[i].rep, b: reps[j].rep, score: Number(score.toFixed(2)) });
    }
  }
  near.sort((x, y) => y.score - x.score);
  return { exact, near };
}

/** Lines that look like secrets — the rubric's DROP:SECRET needs a pointer, not a guess. */
export function findSecrets(lines) {
  const patterns = [
    /\b(sk|pk|ghp|gho|ghu|ghs|ghr|xox[bap]|AKIA)[-_a-z0-9]{10,}/i,
    /\b(api[_-]?key|token|secret|password|passwd)\b\s*[:=]\s*\S{6,}/i,
    /\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/i,
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/
  ];
  return lines.filter((l) => patterns.some((re) => re.test(l.text)));
}

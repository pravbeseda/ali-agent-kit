// Shared between ali-instructions-global and ali-instructions-project.
// JSONC (VS Code settings) — parse with comments and trailing commas, and edit
// top-level keys in place while keeping comments, indentation and EOL.

/** Token scan: yields {type, start, end} for the string, skipping comments. */
function* tokens(text) {
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === '/' && text[i + 1] === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? n : end;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? n : end + 2;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\') j++;
        j++;
      }
      yield { type: 'string', start: i, end: j + 1 };
      i = j + 1;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if ('{}[]:,'.includes(c)) {
      yield { type: c, start: i, end: i + 1 };
      i++;
      continue;
    }
    let j = i;
    while (j < n && !/[\s{}\[\]:,"]/.test(text[j]) && !(text[j] === '/' && /[/*]/.test(text[j + 1]))) j++;
    yield { type: 'literal', start: i, end: j };
    i = j;
  }
}

/** Strip comments and trailing commas, then JSON.parse. Empty text → {}. */
export function parseJsonc(text) {
  const clean = text.replace(/^\uFEFF/, '');
  let out = '';
  let last = 0;
  const kept = [];
  for (const tok of tokens(clean)) kept.push(tok);
  for (const tok of kept) {
    out += clean.slice(last, tok.start).replace(/[^\s]/g, ' ');
    out += clean.slice(tok.start, tok.end);
    last = tok.end;
  }
  out = out.replace(/,(\s*[}\]])/g, '$1');
  if (!out.trim()) return {};
  return JSON.parse(out);
}

/** Top-level entries: [{key, keyStart, valueStart, valueEnd, endWithComma}] */
function topLevelEntries(text) {
  const toks = [...tokens(text)];
  const entries = [];
  let depth = 0;
  let expectKey = false;
  let current = null;
  let objectStart = -1;
  let objectEnd = -1;
  for (let i = 0; i < toks.length; i++) {
    const tok = toks[i];
    if (tok.type === '{' || tok.type === '[') {
      depth++;
      if (depth === 1 && tok.type === '{') {
        objectStart = tok.start;
        expectKey = true;
      }
      continue;
    }
    if (tok.type === '}' || tok.type === ']') {
      if (depth === 1 && current) {
        current.valueEnd = prevEnd(toks, i);
        current.commaEnd = null;
        entries.push(current);
        current = null;
      }
      depth--;
      if (depth === 0 && tok.type === '}') objectEnd = tok.start;
      continue;
    }
    if (depth !== 1) continue;
    if (expectKey && tok.type === 'string') {
      current = { key: JSON.parse(text.slice(tok.start, tok.end)), keyStart: tok.start };
      expectKey = false;
      continue;
    }
    if (current && tok.type === ':' && current.valueStart === undefined) {
      current.valueStart = toks[i + 1]?.start;
      continue;
    }
    if (tok.type === ',' && current) {
      current.valueEnd = prevEnd(toks, i);
      current.commaEnd = tok.end;
      entries.push(current);
      current = null;
      expectKey = true;
    }
  }
  return { entries, objectStart, objectEnd };
}

function prevEnd(toks, i) {
  return toks[i - 1].end;
}

function detectEol(text) {
  return /\r\n/.test(text) ? '\r\n' : '\n';
}

function detectIndent(text, entries) {
  if (entries.length) {
    const lineStart = text.lastIndexOf('\n', entries[0].keyStart) + 1;
    const ws = text.slice(lineStart, entries[0].keyStart);
    if (/^\s+$/.test(ws)) return ws;
  }
  return '  ';
}

/**
 * Set top-level `key` to `value` (JSON-serialisable). Replaces the value span of an
 * existing key or inserts a new `"key": value` line before the closing brace.
 * `value === undefined` removes the key. Returns the new text.
 */
export function setTopLevelKey(text, key, value) {
  const eol = detectEol(text);
  const src = text.replace(/^\uFEFF/, '');
  if (!src.trim()) {
    if (value === undefined) return src;
    return `{${eol}  ${JSON.stringify(key)}: ${serialize(value, '  ', eol)}${eol}}${eol}`;
  }
  const { entries, objectStart, objectEnd } = topLevelEntries(src);
  if (objectStart === -1 || objectEnd === -1) throw new Error('settings file is not a JSON object');
  const indent = detectIndent(src, entries);
  const existing = entries.find((e) => e.key === key);

  if (existing) {
    if (value === undefined) {
      // remove from line start (keeping earlier content) to after the comma or value
      const lineStart = src.lastIndexOf('\n', existing.keyStart) + 1;
      const from = /^\s*$/.test(src.slice(lineStart, existing.keyStart)) ? lineStart : existing.keyStart;
      let to = existing.commaEnd ?? existing.valueEnd;
      const nl = src.indexOf('\n', to);
      if (nl !== -1 && /^\s*$/.test(src.slice(to, nl))) to = nl + 1;
      let out = src.slice(0, from) + src.slice(to);
      // a removed last entry may leave a dangling comma on the previous entry
      if (!existing.commaEnd) out = out.replace(/,(\s*)(?=\}\s*$)/, '$1');
      return out;
    }
    return src.slice(0, existing.valueStart) + serialize(value, indent, eol) + src.slice(existing.valueEnd);
  }
  if (value === undefined) return src;

  const line = `${indent}${JSON.stringify(key)}: ${serialize(value, indent, eol)}`;
  if (entries.length === 0) {
    return src.slice(0, objectStart + 1) + eol + line + eol + src.slice(objectEnd).replace(/^\s*/, '');
  }
  const lastEntry = entries[entries.length - 1];
  if (lastEntry.commaEnd) {
    // trailing-comma style: keep it, add the line after the comma
    return src.slice(0, lastEntry.commaEnd) + eol + line + ',' + src.slice(lastEntry.commaEnd);
  }
  // no trailing comma: comma right after the value, new line after the end of that line
  // (so a same-line comment stays with its entry), but never past the closing brace
  const nl = src.indexOf('\n', lastEntry.valueEnd);
  let lineEnd = nl === -1 || nl > objectEnd ? objectEnd : nl - (src[nl - 1] === '\r' ? 1 : 0);
  if (lineEnd === objectEnd) lineEnd = src.slice(0, objectEnd).replace(/\s+$/, '').length;
  return src.slice(0, lastEntry.valueEnd) + ',' + src.slice(lastEntry.valueEnd, lineEnd) + eol + line + src.slice(lineEnd);
}

function serialize(value, indent, eol) {
  const json = JSON.stringify(value, null, indent);
  return json.replace(/\n/g, eol + indent);
}

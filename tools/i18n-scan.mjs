#!/usr/bin/env node
// List likely hard-coded user-facing English strings in src/ (the i18n to-do list and final check).
//
// Usage (repo root):
//   node tools/i18n-scan.mjs                 every finding, per file, with line numbers, and totals
//   node tools/i18n-scan.mjs src/settings    only these files / folders
//   node tools/i18n-scan.mjs --summary       totals per file and folder only
//   node tools/i18n-scan.mjs --json          machine-readable
//   node tools/i18n-scan.mjs --check …       exit code 1 when anything is found (CI / final check)
//
// Heuristic, not a parser: it tokenizes JS (comments, strings, template literals, regex literals) and
// reports a string literal when
//   - it is in a UI position: el()/toast()/confirmDialog()/… argument, textContent / innerText /
//     title / label / placeholder / aria-label / message / hint / subtitle … value, or
//   - it reads like English text: a capitalised word ('Save') or two or more plain words ('last week'),
// and it is not obviously code: imports, CSS class lists, ids, event / key names, URLs, selectors,
// t('…') keys, console.* / new Error(…) arguments, comparisons (=== 'x'), units alone ('kg', 'kcal').
// Escape hatch for legitimate literals (units, brand names, formats, matching data, LLM prompts):
// `// i18n-ignore` at the end of the line, `// i18n-ignore-next-line` on the line before,
// `// i18n-ignore-start` … `// i18n-ignore-end` around a block, `// i18n-ignore-file` anywhere in a file.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Never scanned: catalogues, data, generated art and icon markup. */
const EXCLUDE = [/^src\/i18n\//, /^src\/data\//, /^src\/ui\/bodymap-art\.js$/, /^src\/ui\/icons\.js$/, /^src\/types\.js$/];

/** Words that are not translated (units, symbols); a literal made only of these is skipped. */
const UNITS = new Set(['kg', 'g', 'kcal', 'kj', 'kJ', 'ml', 'l', 'min', 'h', 's', 't', 'cm', 'mm', 'm', 'km', 'lb',
  'lbs', 'x', 'B', 'KB', 'MB', 'GB', 'RPE', 'RIR', 'BMI', 'TDEE', '1RM', 'API', 'JSON', 'CSV', 'PWA', 'iOS',
  'Android', 'OK']);
/** Single capitalised words that are code, not text (DOM key names, error names, MIME parts …). */
const CODE_WORDS = new Set(['Enter', 'Escape', 'Esc', 'Tab', 'Backspace', 'Delete', 'Home', 'End', 'PageUp',
  'PageDown', 'Space', 'Shift', 'Control', 'Alt', 'Meta', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
  'Content-Type', 'Authorization', 'Accept', 'GET', 'POST', 'PUT', 'DELETE', 'Bearer', 'Infinity', 'NaN',
  'AbortError', 'NotAllowedError', 'NotFoundError', 'NotReadableError', 'OverconstrainedError', 'SecurityError',
  'QuotaExceededError', 'TimeoutError', 'TypeError', 'Error', 'UTF-8', 'SHA-256', 'Tracker']);
/** Functions whose string arguments are user-facing. */
const UI_CALLS = ['el', 'toast', 'alert', 'confirm', 'prompt', 'confirmDialog', 'emptyState', 'sectionHeader',
  'cardHeader', 'tag', 'field', 'pageHeader', 'statTile', 'append', 'replaceChildren', 'createTextNode',
  'openSheet', 'openModal', 'setBadge', 'p', 'b', 'li', 'h', 'line', 'note', 'row', 'section', 'group', 'linkRow',
  'rowParts', 'notice', 'chip', 'btn', 'button', 'label', 'option', 'card', 'linkCard', 'go', 'hint', 'tile', 'muted'];
/** Functions whose string arguments are code (keys, ids, names). */
const CODE_CALLS = ['t', 'icon', 'iconButton', 'href', 'navigate', 'back', 'querySelector', 'querySelectorAll',
  'getElementById', 'closest', 'matches', 'addEventListener', 'removeEventListener', 'dispatchEvent', 'CustomEvent',
  'getItem', 'setItem', 'removeItem', 'getSetting', 'setSetting', 'get', 'put', 'remove', 'getAll', 'byIndex', 'range',
  'transaction', 'count', 'createElement', 'createElementNS', 'setAttribute', 'getAttribute', 'removeAttribute',
  'hasAttribute', 'toggleAttribute', 'add', 'toggle', 'contains', 'matchMedia', 'import', 'require', 'URL', 'fetch',
  'Error', 'TypeError', 'RangeError', 'log', 'info', 'warn', 'error', 'debug', 'infoButton', 'openInfo', 'infoSheet',
  'hasIcon', 'includes', 'startsWith', 'endsWith', 'indexOf', 'split', 'join', 'replace', 'replaceAll', 'match',
  'test', 'RegExp', 'Intl', 'DateTimeFormat', 'NumberFormat', 'PluralRules', 'loadDraft', 'saveDraft', 'clearDraft',
  'postMessage', 'Blob', 'File', 'has', 'delete', 'set', 'padStart', 'padEnd', 'toFixed', 'localeCompare', 'Symbol',
  'mark', 'measure', 'ensureCss', 'Worker', 'importScripts', 'getContext', 'toDataURL', 'toBlob', 'decode', 'encode',
  'muscleName', 'muscleIcon', 'bodyMap'];
/** Property names whose string values are user-facing. */
const UI_PROPS = ['textContent', 'innerText', 'title', 'label', 'labels', 'placeholder', 'aria-label', 'ariaLabel',
  'aria-description', 'aria-valuetext', 'alt', 'message', 'confirmLabel', 'cancelLabel', 'subtitle', 'hint', 'sub',
  'text', 'trail', 'caption', 'heading', 'summary', 'empty', 'emptyText', 'description', 'desc', 'note', 'error',
  'tooltip', 'unitLabel', 'okLabel', 'action', 'paragraphs', 'body', 'lead', 'detail', 'reason', 'why', 'help', 'name'];
/** Property names whose string values are code. */
const CODE_PROPS = ['class', 'className', 'type', 'rel', 'href', 'src', 'id', 'key', 'icon', 'role', 'tone', 'variant',
  'inputmode', 'inputMode', 'enterkeyhint', 'autocomplete', 'autocapitalize', 'accept', 'download', 'kind', 'tab',
  'path', 'mode', 'status', 'direction', 'view', 'value', 'htmlFor', 'for', 'lang', 'dir', 'target', 'method', 'size',
  'step', 'min', 'max', 'pattern', 'style', 'stroke', 'fill', 'd', 'x', 'y', 'viewBox', 'xmlns', 'transform',
  'text-anchor', 'loading', 'decoding', 'preload', 'sizes', 'media', 'unit', 'basis', 'format', 'state', 'source',
  'cache', 'credentials', 'headers', 'event', 'part', 'slot', 'is', 'cls', 'aria-hidden', 'aria-live', 'aria-current',
  'aria-pressed', 'aria-selected', 'aria-expanded', 'aria-controls', 'aria-haspopup', 'aria-modal', 'aria-labelledby',
  'aria-describedby', 'aria-invalid', 'tabindex', 'width', 'height', 'color', 'font', 'display', 'position', 'model',
  'provider', 'equipment', 'muscle', 'scope', 'mime', 'ext', 'encoding', 'dateOrder', 'sep',
  'delimiter', 'level', 'answer', 'pace', 'splitId', 'routineId', 'exerciseId', 'meal', 'version'];

// ---------------------------------------------------------------- tokenizer

/**
 * String literals of a JS source with line numbers and the code just before each.
 * @returns {{text: string, line: number, before: string, template: boolean}[]}
 */
export function stringLiterals(src) {
  const out = [];
  let i = 0; let line = 1;
  let lastSig = ''; // last significant token (char or word) for regex detection
  const n = src.length;
  const stack = []; // open ${ … } of template literals: { depth: unclosed braces inside, lit }
  const lineStart = () => src.lastIndexOf('\n', i - 1) + 1;
  const isRegexStart = () => !lastSig || /[(,=:[!&|?{};+\-*%<>~^]$/.test(lastSig) || /^(return|typeof|case|in|of|delete|void|throw|new|else|do|yield|await)$/.test(lastSig);
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop; continue;
    }
    if (c === '\'' || c === '"') {
      const startLine = line; const before = src.slice(lineStart(), i);
      let j = i + 1; let text = '';
      while (j < n && src[j] !== c) {
        if (src[j] === '\\') { text += src[j + 1] === 'n' ? '\n' : src[j + 1]; j += 2; continue; }
        if (src[j] === '\n') break;
        text += src[j]; j++;
      }
      out.push({ text, line: startLine, before, template: false });
      i = j + 1; lastSig = 'str'; continue;
    }
    if (c === '`' || (c === '}' && stack.length && stack[stack.length - 1].depth === 0)) {
      // template literal, or its continuation after ${ … }: one literal with '{}' for each expression
      let lit;
      if (c === '}') lit = stack.pop().lit;
      else { lit = { text: '', line, before: src.slice(lineStart(), i), template: true }; out.push(lit); }
      let j = i + 1;
      let opened = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { lit.text += src[j + 1]; j += 2; continue; }
        if (d === '`') { j++; break; }
        if (d === '$' && src[j + 1] === '{') { stack.push({ depth: 0, lit }); j += 2; opened = true; lit.text += '{}'; break; }
        if (d === '\n') line++;
        lit.text += d; j++;
      }
      i = j; lastSig = opened ? '{' : 'str'; continue;
    }
    if (c === '{') { if (stack.length) stack[stack.length - 1].depth++; lastSig = '{'; i++; continue; }
    if (c === '}') { if (stack.length) stack[stack.length - 1].depth--; lastSig = '}'; i++; continue; }
    if (c === '/' && isRegexStart()) {
      let j = i + 1; let inClass = false;
      while (j < n && src[j] !== '\n') {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === '[') inClass = true;
        else if (src[j] === ']') inClass = false;
        else if (src[j] === '/' && !inClass) break;
        j++;
      }
      j++;
      while (j < n && /[a-z]/i.test(src[j])) j++;
      i = j; lastSig = 'regex'; continue;
    }
    if (/[A-Za-z_$0-9]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z_$0-9]/.test(src[j])) j++;
      lastSig = src.slice(i, j); i = j; continue;
    }
    lastSig = c; i++;
  }
  return out;
}

// ---------------------------------------------------------------- classification

const callName = (before) => {
  // name of the innermost unclosed call on the line before the literal: "toast(`x" → toast
  let depth = 0;
  for (let k = before.length - 1; k >= 0; k--) {
    const ch = before[k];
    if (ch === ')' || ch === ']') depth++;
    else if (ch === '(' || ch === '[') {
      if (depth === 0) {
        if (ch === '[') return '[';
        const m = /([A-Za-z_$][\w$]*)\s*$/.exec(before.slice(0, k));
        return m ? m[1] : '(';
      }
      depth--;
    }
  }
  return null;
};

const propName = (before) => {
  const m = /(?:['"]?([\w-]+)['"]?\s*:|\.([\w$]+)\s*=(?!=))\s*$/.exec(before);
  return m ? (m[1] || m[2]) : null;
};

/** Letters-only words of a text, placeholders and units removed. */
function words(text) {
  return text.replace(/\{\}/g, ' ').split(/[^\p{L}0-9'’-]+/u).filter((w) => /\p{L}/u.test(w) && !UNITS.has(w));
}

/** @returns {string|null} reason when the literal looks like user-facing English, else null */
export function classify(lit) {
  const { text, before } = lit;
  const trimmed = text.trim();
  if (!trimmed || !/[A-Za-z]{2,}/.test(trimmed)) return null;
  if (/(^|\s)(import|export)\b.*\bfrom\s*$/.test(before) || /^\s*import\s*$/.test(before)) return null;
  if (/(===|!==|==|!=|\bcase)\s*$/.test(before)) return null;
  if (/^(https?:|data:|blob:|mailto:|\.\.?\/|#\/|[#.[][\w-])/.test(trimmed)) return null; // URLs, paths, selectors
  if (/^[\w.-]+\/[\w.+-]+$/.test(trimmed)) return null; // MIME types, paths
  if (/^[a-z][\w]*(\.[\w]+)+$/i.test(trimmed) && !/\s/.test(trimmed)) return null; // dotted keys
  const ws = words(trimmed);
  if (!ws.length) return null; // only units / numbers / symbols
  const prop = propName(before);
  const call = callName(before);
  if (prop && CODE_PROPS.includes(prop)) return null;
  if (call && CODE_CALLS.includes(call) && !(prop && UI_PROPS.includes(prop))) {
    // first argument of a code call; but a UI prop inside an options object of a code call still counts
    return null;
  }
  if (/\bconsole\.\w+\([^)]*$/.test(before) || /\bnew\s+\w*Error\([^)]*$/.test(before)) return null;
  const tokens = trimmed.split(/\s+/);
  const classList = tokens.every((tk) => /^[a-z0-9]+(-[a-z0-9]+)*$/.test(tk)) && tokens.some((tk) => tk.includes('-'));
  if (classList) return null;
  if (tokens.length === 1 && (CODE_WORDS.has(trimmed) || /[a-z][A-Z]/.test(trimmed) || /^[A-Z0-9_]+$/.test(trimmed) || /[_$]/.test(trimmed))) return null;
  const uiProp = prop && UI_PROPS.includes(prop);
  const uiCall = call && UI_CALLS.includes(call);
  if (uiProp) return `prop ${prop}`;
  if (uiCall && !/^[a-z][a-z0-9]*$/.test(trimmed)) return `${call}()`;
  if (/\b[A-Z][a-z]+/.test(trimmed) && !/^[A-Z][a-z]+[A-Z]/.test(trimmed)) return 'text';
  if (ws.length >= 2 && /\s/.test(trimmed) && ws.every((w) => /^[a-z’'-]+$/i.test(w))) return 'words';
  if (lit.template && ws.some((w) => w.length > 2) && /\s/.test(trimmed)) return 'template';
  return null;
}

// ---------------------------------------------------------------- files

/** Findings for one source text. */
export function scanSource(src) {
  const lines = src.split('\n');
  if (/\/\/\s*i18n-ignore-file\b/.test(src)) return [];
  const blocked = new Set(); // lines between // i18n-ignore-start and // i18n-ignore-end
  let inBlock = false;
  lines.forEach((l, k) => {
    if (/\/\/\s*i18n-ignore-start\b/.test(l)) inBlock = true;
    if (inBlock) blocked.add(k + 1);
    if (/\/\/\s*i18n-ignore-end\b/.test(l)) inBlock = false;
  });
  const ignored = (ln) => blocked.has(ln) || /\/\/\s*i18n-ignore\b(?!-)/.test(lines[ln - 1] || '') || /\/\/\s*i18n-ignore-next-line\b/.test(lines[ln - 2] || '');
  const out = [];
  for (const lit of stringLiterals(src)) {
    const reason = classify(lit);
    if (reason && !ignored(lit.line)) out.push({ line: lit.line, text: lit.text, reason });
  }
  return out;
}

function walk(abs) {
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs).sort().flatMap((name) => (name.startsWith('.') ? [] : walk(join(abs, name))));
}

/** @param {string[]} [targets] paths relative to the repo root (default: src) */
export function scan(targets = ['src']) {
  const files = targets.flatMap((tg) => walk(join(ROOT, tg)))
    .map((abs) => relative(ROOT, abs).split(sep).join('/'))
    .filter((p) => p.endsWith('.js') && !EXCLUDE.some((re) => re.test(p)));
  return [...new Set(files)].map((file) => ({ file, findings: scanSource(readFileSync(join(ROOT, file), 'utf8')) }));
}

function folderOf(file) {
  const parts = file.split('/');
  return parts.length > 2 ? `${parts[0]}/${parts[1]}` : parts[0];
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const flags = new Set(args.filter((a) => a.startsWith('--')));
  const targets = args.filter((a) => !a.startsWith('--'));
  const results = scan(targets.length ? targets : ['src']);
  const total = results.reduce((s, r) => s + r.findings.length, 0);
  if (flags.has('--json')) {
    console.log(JSON.stringify({ total, files: results.filter((r) => r.findings.length) }, null, 1));
  } else {
    const perFolder = new Map();
    for (const r of results) {
      if (!r.findings.length) continue;
      perFolder.set(folderOf(r.file), (perFolder.get(folderOf(r.file)) || 0) + r.findings.length);
      console.log(`${r.file}  (${r.findings.length})`);
      if (!flags.has('--summary')) {
        for (const f of r.findings) console.log(`  ${String(f.line).padStart(5)}  ${JSON.stringify(f.text.length > 90 ? `${f.text.slice(0, 87)}…` : f.text)}`);
      }
    }
    console.log('\nPer folder:');
    for (const [folder, n] of [...perFolder].sort()) console.log(`  ${folder.padEnd(18)} ${n}`);
    console.log(`Total: ${total} likely hard-coded strings in ${results.filter((r) => r.findings.length).length} of ${results.length} files`);
  }
  if (flags.has('--check') && total) process.exit(1);
}

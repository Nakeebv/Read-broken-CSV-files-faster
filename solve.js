// A drop-in for make.fun's csv-reader 1.0.0 with exactly the same answers.
// The reference builds every field with `value += c`, leaving long cons-string
// chains for V8 to flatten. This scanner walks the text once with charCodeAt
// and cuts each field out with slice(), joining only the few pieces that need
// rewriting (doubled quotes, CR -> LF, stray CRs).
//
// The helpers live at module scope, not inside run(): one closure object per
// case makes V8's inline caches see a different call target every time and
// throws away the optimized code. The state is module-global, so run() is
// synchronous and non-reentrant, as the harness calls it.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

let text = '';
let n = 0;
let errors = [];
let rows = [];
let columns = null;
let width = -1;
let pos = 0;
let line = 1;
let recordLine = 1;
let recordRow = null;
let fv = '';
let fe = END;

function addError(code) {
  errors.push({ code, line: recordLine, row: recordRow });
}

function finish(start, end, pieces, prefix) {
  let s;
  if (pieces === null) {
    s = text.slice(start, end);
  } else {
    if (end > start) pieces.push(text.slice(start, end));
    s = pieces.join('');
  }
  return prefix === '' ? s : prefix + s;
}

function readUnquoted(prefix) {
  let start = pos;
  let pieces = null;
  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 44) {
      fv = finish(start, pos, pieces, prefix);
      fe = COMMA;
      pos += 1;
      return;
    }
    if (c === 10) {
      fv = finish(start, pos, pieces, prefix);
      fe = LINE_BREAK;
      pos += 1;
      line += 1;
      return;
    }
    if (c === 13) {
      if (pieces === null) pieces = [];
      pieces.push(text.slice(start, pos));
      if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        fv = finish(pos, pos, pieces, prefix);
        fe = LINE_BREAK;
        return;
      }
      addError('stray_cr');
      pos += 1;
      start = pos;
      continue;
    }
    pos += 1;
  }
  fv = finish(start, pos, pieces, prefix);
  fe = END;
}

function readQuoted() {
  const open = pos;
  const openLine = line;
  pos += 1;
  let start = pos;
  let pieces = null;
  let value = '';
  let closed = false;

  while (pos < n) {
    const c = text.charCodeAt(pos);
    if (c === 34) {
      if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) {
        if (pieces === null) pieces = [];
        pieces.push(text.slice(start, pos));
        pieces.push('"');
        pos += 2;
        start = pos;
        continue;
      }
      if (pieces === null) {
        value = text.slice(start, pos);
      } else {
        pieces.push(text.slice(start, pos));
        value = pieces.join('');
      }
      pos += 1;
      closed = true;
      break;
    }
    if (c === 13) {
      if (pieces === null) pieces = [];
      pieces.push(text.slice(start, pos));
      pieces.push('\n');
      pos += pos + 1 < n && text.charCodeAt(pos + 1) === 10 ? 2 : 1;
      line += 1;
      start = pos;
      continue;
    }
    if (c === 10) line += 1;
    pos += 1;
  }

  if (!closed) {
    pos = open + 1;
    line = openLine;
    addError('unterminated_quote');
    readUnquoted('"');
    return;
  }

  if (pos >= n) {
    fv = value;
    fe = END;
    return;
  }
  const c = text.charCodeAt(pos);
  if (c === 44) {
    pos += 1;
    fv = value;
    fe = COMMA;
    return;
  }
  if (c === 10) {
    pos += 1;
    line += 1;
    fv = value;
    fe = LINE_BREAK;
    return;
  }
  if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
    pos += 2;
    line += 1;
    fv = value;
    fe = LINE_BREAK;
    return;
  }
  const before = value.length;
  readUnquoted(value);
  if (fv.length > before) addError('quote_junk');
}

export function run(input) {
  text = String(input.text);
  const header = input.header === true;
  n = text.length;
  errors = [];
  rows = [];
  columns = null;
  width = -1;
  pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  line = 1;
  recordLine = 1;
  recordRow = null;

  while (true) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) readQuoted();
      else readUnquoted('');
      fields.push(fv);
    } while (fe === COMMA);

    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

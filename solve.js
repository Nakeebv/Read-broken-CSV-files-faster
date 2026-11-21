// A drop-in for make.fun's csv-reader 1.0.0 with exactly the same answers.
// The reference builds every field one character at a time (`value += c`), leaving long cons-string
// chains for V8 to flatten. This scanner walks the same text once with charCodeAt and cuts each
// field out with slice(), joining only the few pieces that need rewriting (doubled quotes, CR -> LF,
// stray CRs). No behaviour differs: errors are emitted in the same order with the same line/row.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = text.charCodeAt(0) === 0xFEFF ? 1 : 0;
  let line = 1;
  let recordLine = 1;
  let recordRow = null;

  // Scratch result of the last field parse; avoids an object per field.
  let fv = '';
  let fe = END;

  function addError(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Join the pieces collected for a field. `start`/`end` bound the final untouched run.
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

  // Unquoted characters from pos up to a comma, a line break or the end. A lone CR is dropped
  // with a stray_cr error; `prefix` is prepended (the literal opening quote, or a quoted value).
  function readUnquoted(prefix) {
    let start = pos;
    let pieces = null;
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ,
        fv = finish(start, pos, pieces, prefix);
        fe = COMMA;
        pos += 1;
        return;
      }
      if (c === 10) { // LF
        fv = finish(start, pos, pieces, prefix);
        fe = LINE_BREAK;
        pos += 1;
        line += 1;
        return;
      }
      if (c === 13) { // CR
        if (pieces === null) pieces = [];
        pieces.push(text.slice(start, pos));
        if (pos + 1 < n && text.charCodeAt(pos + 1) === 10) { // CRLF ends the field
          pos += 2;
          line += 1;
          start = pos;
          fv = finish(start, pos, pieces, prefix);
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

  // A field whose first character is a double quote.
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
      if (c === 34) { // "
        if (pos + 1 < n && text.charCodeAt(pos + 1) === 34) { // "" -> "
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
      if (c === 13) { // CRLF and lone CR inside quotes are each one LF
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
    // What follows the closing quote, up to the next comma or line break, is appended as it stands.
    const before = value.length;
    readUnquoted(value);
    if (fv.length > before) addError('quote_junk');
  }

  while (true) {
    // A line with no characters is no record.
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

    // A line that held only stray CRs is left with no characters: no record (its errors stay).
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

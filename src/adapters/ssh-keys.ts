/**
 * SSH Adapter — Key parser
 *
 * Parses raw bytes from a pty stdin into structured KeyEvent objects.
 * Recognises common ANSI escape sequences (arrows, function keys, navigation)
 * and ASCII control codes.
 *
 * Inspired by Node's internal `readline` keypress parser but kept minimal
 * and self-contained (no readline dep, no process.stdin coupling).
 */

import type { KeyEvent } from './ssh-types.js'

const NAMED_CSI: Record<string, string> = {
  A: 'up',
  B: 'down',
  C: 'right',
  D: 'left',
  H: 'home',
  F: 'end',
  // CSI ~ family
  '2~': 'insert',
  '3~': 'delete',
  '5~': 'pageup',
  '6~': 'pagedown',
  '7~': 'home',
  '8~': 'end',
  '11~': 'f1',
  '12~': 'f2',
  '13~': 'f3',
  '14~': 'f4',
  '15~': 'f5',
  '17~': 'f6',
  '18~': 'f7',
  '19~': 'f8',
  '20~': 'f9',
  '21~': 'f10',
  '23~': 'f11',
  '24~': 'f12',
}

// SS3 sequences (ESC O X) — common for F1-F4
const SS3: Record<string, string> = {
  P: 'f1',
  Q: 'f2',
  R: 'f3',
  S: 'f4',
  H: 'home',
  F: 'end',
}

/**
 * Parse one buffer chunk into zero or more KeyEvents.
 *
 * Best-effort: an incoming chunk may contain multiple keys (bracketed
 * paste, key spam) and we emit them in order. An incomplete escape
 * sequence at the end is dropped (the next chunk should re-deliver it
 * since terminals send escape sequences in one frame in practice).
 */
export function parseKeys(buf: Buffer): KeyEvent[] {
  const out: KeyEvent[] = []
  let i = 0

  while (i < buf.length) {
    const byte = buf[i]!

    // ESC — start of escape sequence
    if (byte === 0x1b) {
      // ESC alone (would be ambiguous; emit as 'escape' if it's the only byte)
      if (i === buf.length - 1) {
        out.push(makeKey(buf.slice(i, i + 1), { name: 'escape' }))
        i++
        continue
      }

      const next = buf[i + 1]!

      // ESC [ — CSI
      if (next === 0x5b /* [ */) {
        const end = findCsiEnd(buf, i + 2)
        if (end === -1) {
          // Incomplete — bail; client likely sends the rest in another chunk
          break
        }
        const seq = buf.slice(i, end + 1)
        out.push(parseCsi(seq))
        i = end + 1
        continue
      }

      // ESC O — SS3
      if (next === 0x4f /* O */ && i + 2 < buf.length) {
        const c = String.fromCharCode(buf[i + 2]!)
        const name = SS3[c]
        out.push(
          makeKey(buf.slice(i, i + 3), {
            name,
            sequence: `\x1bO${c}`,
          }),
        )
        i += 3
        continue
      }

      // ESC <char> — alt+char
      if (next >= 0x20 && next < 0x7f) {
        const ch = String.fromCharCode(next)
        out.push(
          makeKey(buf.slice(i, i + 2), {
            str: ch,
            name: ch.toLowerCase(),
            meta: true,
            shift: ch >= 'A' && ch <= 'Z',
          }),
        )
        i += 2
        continue
      }

      // Unknown ESC sequence — drop ESC, treat next bytes normally
      i++
      continue
    }

    // ASCII control codes
    if (byte < 0x20 || byte === 0x7f) {
      out.push(parseControl(byte, buf.slice(i, i + 1)))
      i++
      continue
    }

    // UTF-8 character (single byte fast path)
    if (byte < 0x80) {
      const ch = String.fromCharCode(byte)
      out.push(
        makeKey(buf.slice(i, i + 1), {
          str: ch,
          name: ch.toLowerCase(),
          shift: ch >= 'A' && ch <= 'Z',
        }),
      )
      i++
      continue
    }

    // Multi-byte UTF-8 — find length
    let len = 1
    if ((byte & 0xe0) === 0xc0) len = 2
    else if ((byte & 0xf0) === 0xe0) len = 3
    else if ((byte & 0xf8) === 0xf0) len = 4
    if (i + len > buf.length) break // incomplete

    const slice = buf.slice(i, i + len)
    out.push(
      makeKey(slice, {
        str: slice.toString('utf8'),
      }),
    )
    i += len
  }

  return out
}

function findCsiEnd(buf: Buffer, start: number): number {
  // CSI final byte is in range 0x40..0x7e
  for (let i = start; i < buf.length; i++) {
    const b = buf[i]!
    if (b >= 0x40 && b <= 0x7e) return i
  }
  return -1
}

function parseCsi(seq: Buffer): KeyEvent {
  const str = seq.toString('ascii')
  const params = str.slice(2, -1) // strip ESC [ and final byte
  const final = str[str.length - 1]!

  // CSI <num>~ family (e.g. 5~ = pageup)
  if (final === '~') {
    const key = `${params}~`
    const name = NAMED_CSI[key]
    return makeKey(seq, { name, sequence: str })
  }

  // CSI <letter> family (arrows, home, end)
  // May include modifier params: ESC[1;5A means ctrl+up
  const name = NAMED_CSI[final]
  let ctrl = false
  let shift = false
  let meta = false
  if (params.includes(';')) {
    const mod = parseInt(params.split(';')[1] ?? '1', 10) - 1
    if (mod & 1) shift = true
    if (mod & 2) meta = true
    if (mod & 4) ctrl = true
  }
  return makeKey(seq, { name, ctrl, shift, meta, sequence: str })
}

function parseControl(byte: number, raw: Buffer): KeyEvent {
  if (byte === 0x0d /* \r */ || byte === 0x0a /* \n */) {
    return makeKey(raw, { name: 'return', str: '\n' })
  }
  if (byte === 0x09 /* \t */) return makeKey(raw, { name: 'tab', str: '\t' })
  if (byte === 0x7f) return makeKey(raw, { name: 'backspace' })
  if (byte === 0x08) return makeKey(raw, { name: 'backspace', ctrl: true })
  if (byte === 0x20 /* space */) return makeKey(raw, { name: 'space', str: ' ' })
  if (byte === 0x1b) return makeKey(raw, { name: 'escape' })

  // Ctrl+A..Ctrl+Z map to 0x01..0x1a
  if (byte >= 0x01 && byte <= 0x1a) {
    const letter = String.fromCharCode(0x60 + byte) // 'a' + (byte - 1)
    return makeKey(raw, { name: letter, ctrl: true, str: letter })
  }

  return makeKey(raw, { sequence: `\\x${byte.toString(16).padStart(2, '0')}` })
}

function makeKey(raw: Buffer, partial: Partial<KeyEvent>): KeyEvent {
  return {
    raw,
    str: partial.str ?? '',
    name: partial.name,
    ctrl: partial.ctrl ?? false,
    shift: partial.shift ?? false,
    meta: partial.meta ?? false,
    sequence: partial.sequence,
  }
}

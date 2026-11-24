import { open } from 'node:fs/promises'

export interface LineChunk {
  lines: string[]
  /** Byte where the first returned line starts. */
  firstLineAt: number
  /** Byte just after the last complete line; the next read starts here. */
  readTo: number
}

const NEWLINE = 10

/**
 * Reads the complete lines between two byte offsets of a file.
 *
 * A line cut by `start` is dropped (unless `start` is the beginning of a line),
 * and a last line with no newline yet is left for the next read, because the
 * agent may still be writing it.
 */
export async function readLines(file: string, start: number, end: number): Promise<LineChunk> {
  const from = Math.max(0, start - 1) // one byte early, to know whether `start` begins a line
  const length = end - from
  if (length <= 0) return { lines: [], firstLineAt: start, readTo: start }

  const handle = await open(file, 'r')
  let buf: Buffer
  try {
    buf = Buffer.allocUnsafe(length)
    let got = 0
    while (got < length) {
      const { bytesRead } = await handle.read(buf, got, length - got, from + got)
      if (bytesRead === 0) break
      got += bytesRead
    }
    buf = buf.subarray(0, got)
  } finally {
    await handle.close()
  }

  let first = 0
  if (start > 0) {
    if (buf[0] === NEWLINE) first = 1
    else {
      const nl = buf.indexOf(NEWLINE)
      if (nl === -1) return { lines: [], firstLineAt: start, readTo: start }
      first = nl + 1
    }
  }
  const last = buf.lastIndexOf(NEWLINE)
  if (last < first) return { lines: [], firstLineAt: from + first, readTo: from + first }

  const text = buf.toString('utf8', first, last)
  return {
    lines: text.length ? text.split('\n') : [''],
    firstLineAt: from + first,
    readTo: from + last + 1,
  }
}

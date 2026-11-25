import { promises as fs } from 'fs'
import { normalizeText } from './normalize'

export async function importTxt(filePath: string): Promise<string> {
  const buffer = await fs.readFile(filePath)

  // 1. EF BB BF = UTF-8 BOM
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    const text = buffer.subarray(3).toString('utf-8')
    return normalizeText(text)
  }

  // 2. FF FE = UTF-16 little-endian
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    const text = buffer.subarray(2).toString('utf16le')
    return normalizeText(text)
  }

  // 3. FE FF = UTF-16 big-endian
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    const swapped = Buffer.allocUnsafe(buffer.length - 2)
    for (let i = 2; i < buffer.length - 1; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    const text = swapped.toString('utf16le')
    return normalizeText(text)
  }

  // 4. Try UTF-8 with fatal: true, fallback to windows-1252
  try {
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return normalizeText(decoded)
  } catch {
    const decoded = new TextDecoder('windows-1252').decode(buffer)
    return normalizeText(decoded)
  }
}

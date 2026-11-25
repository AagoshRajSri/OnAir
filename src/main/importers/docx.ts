import mammoth from 'mammoth'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { normalizeText } from './normalize'

export async function importDocx(filePath: string, win: BrowserWindow): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ path: filePath })
    return normalizeText(result.value)
  } catch {
    win.webContents.send(IPC.toast, 'Could not read this Word file.')
    throw new Error('Could not read this Word file.')
  }
}

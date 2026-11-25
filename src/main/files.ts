import { dialog, BrowserWindow } from 'electron'
import { promises as fs } from 'fs'
import { extname, basename } from 'path'
import { IPC } from '../shared/types'
import type { ContentIncomingPayload } from '../shared/types'
import { importTxt } from './importers/txt'
import { importPdf } from './importers/pdf'
import { importDocx } from './importers/docx'

const MAX_BYTES = 10_485_760 // 10 MB
const ALLOWED_EXTENSIONS = new Set(['.txt', '.pdf', '.docx'])

export async function openFileDialog(win: BrowserWindow): Promise<string | null> {
  const result = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      { name: 'Text, PDF, Word', extensions: ['txt', 'pdf', 'docx'] }
    ]
  })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export async function importFile(filePath: string, win: BrowserWindow): Promise<string> {
  const ext = extname(filePath).toLowerCase()

  if (!ALLOWED_EXTENSIONS.has(ext)) {
    win.webContents.send(IPC.toast, 'Unsupported file type. Use TXT, PDF or DOCX.')
    throw new Error('Unsupported file type')
  }

  const stat = await fs.stat(filePath)
  if (stat.size > MAX_BYTES) {
    win.webContents.send(IPC.toast, 'File is over 10 MB.')
    throw new Error('File is over 10 MB.')
  }

  let text: string
  switch (ext) {
    case '.txt':
      text = await importTxt(filePath)
      break
    case '.pdf':
      text = await importPdf(filePath, win)
      break
    case '.docx':
      text = await importDocx(filePath, win)
      break
    default:
      throw new Error('Unsupported extension')
  }

  const payload: ContentIncomingPayload = {
    text,
    source: 'file',
    fileName: basename(filePath),
    sentAt: Date.now()
  }
  win.webContents.send(IPC.contentIncoming, payload)
  return text
}

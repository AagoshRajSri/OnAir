import { promises as fs } from 'fs'
import { BrowserWindow } from 'electron'
import { IPC } from '../../shared/types'
import { normalizeText } from './normalize'

export async function importPdf(filePath: string, win: BrowserWindow): Promise<string> {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const buffer = await fs.readFile(filePath)
  const data = new Uint8Array(buffer)

  let pdfDoc: any
  try {
    const loadingTask = pdfjs.getDocument({
      data,
      isEvalSupported: false
    })
    pdfDoc = await loadingTask.promise
  } catch (err: unknown) {
    const e = err as { name?: string; message?: string }
    if (e.name === 'PasswordException') {
      win.webContents.send(IPC.toast, 'This PDF is password protected.')
      throw new Error('This PDF is password protected.')
    }
    throw err
  }

  const numPages: number = pdfDoc.numPages
  const pageTexts: string[] = []

  for (let i = 1; i <= numPages; i++) {
    const page = await pdfDoc.getPage(i)
    const content = await page.getTextContent()
    let pageStr = ''
    for (const item of content.items as Array<{ str: string; hasEOL?: boolean }>) {
      pageStr += item.str
      if (item.hasEOL) {
        pageStr += '\n'
      }
    }
    pageTexts.push(pageStr)
  }

  const fullText = pageTexts.join('\n\n')
  const nonSpaceCount = fullText.replace(/\s/g, '').length

  if (nonSpaceCount < 20) {
    win.webContents.send(
      IPC.toast,
      'This PDF has no selectable text (it may be scanned). OCR is planned for a later phase.'
    )
    throw new Error('This PDF has no selectable text (it may be scanned).')
  }

  return normalizeText(fullText)
}

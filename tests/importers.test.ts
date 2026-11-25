import { describe, it, expect, vi } from 'vitest'
import { join } from 'path'
import { importTxt } from '../src/main/importers/txt'
import { importPdf } from '../src/main/importers/pdf'
import { importDocx } from '../src/main/importers/docx'
import { importFile } from '../src/main/files'

const fixturesDir = join(__dirname, '../fixtures')

describe('File Importers Parsing', () => {
  it('decodes UTF-8 text with BOM properly', async () => {
    const text = await importTxt(join(fixturesDir, 'sample-utf8.txt'))
    expect(text).toContain('Hello from OnAir!')
    expect(text).toContain('café')
    expect(text).toContain('naïve')
    expect(text).toContain('résumé')
  })

  it('decodes Windows-1252 text with accented characters', async () => {
    const text = await importTxt(join(fixturesDir, 'sample-windows1252.txt'))
    expect(text).toContain('Café')
    expect(text).toContain('naïve')
    expect(text).toContain('über')
    expect(text).toContain('façade')
  })

  it('reads text from selectable PDF', async () => {
    const mockWin = {
      webContents: {
        send: vi.fn()
      }
    } as any

    const text = await importPdf(join(fixturesDir, 'sample-text.pdf'), mockWin)
    expect(text).toContain('OnAir floating reader companion')
  })

  it('detects scanned PDF with < 20 non-space characters and emits toast', async () => {
    const mockWin = {
      webContents: {
        send: vi.fn()
      }
    } as any

    await expect(importPdf(join(fixturesDir, 'sample-scanned.pdf'), mockWin)).rejects.toThrow(
      'This PDF has no selectable text (it may be scanned).'
    )
    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      'toast',
      'This PDF has no selectable text (it may be scanned). OCR is planned for a later phase.'
    )
  })

  it('extracts all paragraphs from a DOCX file', async () => {
    const mockWin = {
      webContents: {
        send: vi.fn()
      }
    } as any

    const text = await importDocx(join(fixturesDir, 'sample.docx'), mockWin)
    expect(text).toContain('First paragraph in DOCX.')
    expect(text).toContain('Second paragraph in DOCX.')
  })

  it('emits toast on unreadable DOCX file', async () => {
    const mockWin = {
      webContents: {
        send: vi.fn()
      }
    } as any

    await expect(importDocx(join(fixturesDir, 'corrupt.docx'), mockWin)).rejects.toThrow(
      'Could not read this Word file.'
    )
    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      'toast',
      'Could not read this Word file.'
    )
  })

  it('rejects unsupported extensions (e.g. PNG)', async () => {
    const mockWin = {
      webContents: {
        send: vi.fn()
      }
    } as any

    await expect(importFile(join(fixturesDir, 'sample.png'), mockWin)).rejects.toThrow(
      'Unsupported file type'
    )
    expect(mockWin.webContents.send).toHaveBeenCalledWith(
      'toast',
      'Unsupported file type. Use TXT, PDF or DOCX.'
    )
  })

  it('rejects files over 10 MB', async () => {
    const mockWin = {
      webContents: {
        send: vi.fn()
      }
    } as any

    await expect(importFile(join(fixturesDir, 'sample-oversized.txt'), mockWin)).rejects.toThrow(
      'File is over 10 MB.'
    )
    expect(mockWin.webContents.send).toHaveBeenCalledWith('toast', 'File is over 10 MB.')
  })
})

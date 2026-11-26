import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { createSecretsStore, type SafeStorageAdapter } from '../src/main/secrets'
import { DEFAULT_SETTINGS, IPC, type AIProviderId } from '../src/shared/types'

vi.mock('electron', () => ({
  app: { getPath: () => tmpdir() },
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => ''
  }
}))

function createMockSafeStorage(available = true): SafeStorageAdapter {
  const XOR_KEY = 0x5a
  return {
    isEncryptionAvailable: () => available,
    encryptString: (plainText: string) => {
      const raw = Buffer.from(plainText, 'utf8')
      const out = Buffer.alloc(raw.length)
      for (let i = 0; i < raw.length; i++) {
        out[i] = raw[i] ^ XOR_KEY
      }
      return out
    },
    decryptString: (encrypted: Buffer) => {
      const out = Buffer.alloc(encrypted.length)
      for (let i = 0; i < encrypted.length; i++) {
        out[i] = encrypted[i] ^ XOR_KEY
      }
      return out.toString('utf8')
    }
  }
}

describe('Phase 3 Contracts & Encrypted Secrets (M8)', () => {
  let dirPath: string
  let filePath: string

  beforeEach(async () => {
    dirPath = join(tmpdir(), `onair-secrets-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    await fs.mkdir(dirPath, { recursive: true })
    filePath = join(dirPath, 'secrets.enc')
  })

  afterEach(async () => {
    await fs.rm(dirPath, { recursive: true, force: true }).catch(() => {})
  })

  it('defines Phase 3 defaults and shortcuts in DEFAULT_SETTINGS', () => {
    expect(DEFAULT_SETTINGS.readingMode).toBe('flow')
    expect(DEFAULT_SETTINGS.rsvpWpm).toBe(350)
    expect(DEFAULT_SETTINGS.bionicStrength).toBe(0.4)
    expect(DEFAULT_SETTINGS.aiProvider).toBe('ollama')
    expect(DEFAULT_SETTINGS.aiModel).toBe('llama3.2')
    expect(DEFAULT_SETTINGS.ollamaUrl).toBe('http://127.0.0.1:11434')
    expect(DEFAULT_SETTINGS.shortcuts.openPrompt).toBe('Ctrl+Alt+P')
    expect(DEFAULT_SETTINGS.shortcuts.cycleMode).toBe('Ctrl+Alt+M')
    expect('secretsGetKey' in IPC).toBe(false)
  })

  it('round-trips API keys via safeStorage and writes zero plaintext to secrets.enc', async () => {
    const store = createSecretsStore({
      filePath,
      safeStorage: createMockSafeStorage(true)
    })

    const secret = 'sk-test-secret-openai-998877665544'
    await store.setKey('openai', secret)

    expect(await store.hasKey('openai')).toBe(true)
    expect(await store.getKey('openai')).toBe(secret)

    const diskContent = await fs.readFile(filePath)
    const diskUtf8 = diskContent.toString('utf8')
    expect(diskUtf8).not.toContain(secret)
    expect(diskUtf8).not.toContain('openai')
  })

  it('handles missing keys and uninitialized secrets.enc gracefully', async () => {
    const store = createSecretsStore({
      filePath,
      safeStorage: createMockSafeStorage(true)
    })

    expect(await store.hasKey('anthropic')).toBe(false)
    expect(await store.getKey('anthropic')).toBeNull()
    await expect(store.deleteKey('anthropic')).resolves.toBeUndefined()
  })

  it('supports multiple providers independently and removes secrets.enc when last key is deleted', async () => {
    const store = createSecretsStore({
      filePath,
      safeStorage: createMockSafeStorage(true)
    })

    await store.setKey('openai', 'sk-openai-1')
    await store.setKey('anthropic', 'sk-ant-2')
    expect(await store.hasKey('openai')).toBe(true)
    expect(await store.hasKey('anthropic')).toBe(true)

    await store.deleteKey('openai')
    expect(await store.hasKey('openai')).toBe(false)
    expect(await store.getKey('openai')).toBeNull()
    expect(await store.getKey('anthropic')).toBe('sk-ant-2')

    await store.deleteKey('anthropic')
    expect(await store.hasKey('anthropic')).toBe(false)
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  it('refuses to write plaintext when safeStorage encryption is unavailable', async () => {
    const store = createSecretsStore({
      filePath,
      safeStorage: createMockSafeStorage(false)
    })

    await expect(store.setKey('gemini', 'AIza-secret-key')).rejects.toThrow(/unavailable/i)
    await expect(fs.stat(filePath)).rejects.toThrow()
  })

  it('rejects empty keys and unsupported provider names', async () => {
    const store = createSecretsStore({
      filePath,
      safeStorage: createMockSafeStorage(true)
    })

    await expect(store.setKey('openai', '   ')).rejects.toThrow(/empty/i)
    await expect(store.setKey('unknown' as AIProviderId, 'sk-123')).rejects.toThrow(/Unsupported/i)
  })
})

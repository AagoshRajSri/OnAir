import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { AIProviderId } from '../shared/types'

const VALID_PROVIDERS: ReadonlySet<AIProviderId> = new Set([
  'ollama',
  'openai',
  'anthropic',
  'gemini',
  'groq'
])

export interface SafeStorageAdapter {
  isEncryptionAvailable(): boolean
  encryptString(plainText: string): Buffer
  decryptString(encrypted: Buffer): string
}

export interface SecretsStoreOptions {
  filePath: string
  safeStorage: SafeStorageAdapter
}

type SecretsMap = Partial<Record<AIProviderId, string>>

function assertValidProvider(provider: string): asserts provider is AIProviderId {
  if (!VALID_PROVIDERS.has(provider as AIProviderId)) {
    throw new Error(`Unsupported AI provider: ${provider}`)
  }
}

async function atomicWriteBuffer(filePath: string, data: Buffer): Promise<void> {
  await fs.mkdir(dirname(filePath), { recursive: true })
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`
  await fs.writeFile(tmp, data)
  await fs.rename(tmp, filePath)
}

/**
 * DPAPI-backed encrypted secret store for AI provider API keys.
 * All keys are serialized into a single encrypted binary blob; plaintext keys are never written to disk.
 */
export class SecretsStore {
  private readonly filePath: string
  private readonly storage: SafeStorageAdapter
  private writeQueue: Promise<void> = Promise.resolve()

  constructor(options: SecretsStoreOptions) {
    this.filePath = options.filePath
    this.storage = options.safeStorage
  }

  private assertAvailable(): void {
    if (!this.storage.isEncryptionAvailable()) {
      throw new Error('OS encryption (Electron safeStorage) is unavailable; refusing to store plaintext API key')
    }
  }

  private async readMap(): Promise<SecretsMap> {
    let encrypted: Buffer
    try {
      encrypted = await fs.readFile(this.filePath)
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return {}
      }
      throw err
    }

    if (encrypted.length === 0) return {}
    this.assertAvailable()

    const decrypted = this.storage.decryptString(encrypted)
    const parsed = JSON.parse(decrypted) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {}
    }

    const result: SecretsMap = {}
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (VALID_PROVIDERS.has(k as AIProviderId) && typeof v === 'string' && v.length > 0) {
        result[k as AIProviderId] = v
      }
    }
    return result
  }

  private async writeMap(map: SecretsMap): Promise<void> {
    this.assertAvailable()
    const entries = Object.keys(map)
    if (entries.length === 0) {
      try {
        await fs.unlink(this.filePath)
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err
      }
      return
    }
    const encrypted = this.storage.encryptString(JSON.stringify(map))
    await atomicWriteBuffer(this.filePath, encrypted)
  }

  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.writeQueue.then(task, task)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined
    )
    return run
  }

  async setKey(provider: AIProviderId, apiKey: string): Promise<void> {
    assertValidProvider(provider)
    const trimmed = apiKey.trim()
    if (!trimmed) {
      throw new Error('API key cannot be empty')
    }
    return this.enqueue(async () => {
      this.assertAvailable()
      const map = await this.readMap()
      map[provider] = trimmed
      await this.writeMap(map)
    })
  }

  async getKey(provider: AIProviderId): Promise<string | null> {
    assertValidProvider(provider)
    return this.enqueue(async () => {
      const map = await this.readMap()
      return map[provider] ?? null
    })
  }

  async hasKey(provider: AIProviderId): Promise<boolean> {
    assertValidProvider(provider)
    return this.enqueue(async () => {
      const map = await this.readMap()
      return typeof map[provider] === 'string' && map[provider]!.length > 0
    })
  }

  async deleteKey(provider: AIProviderId): Promise<void> {
    assertValidProvider(provider)
    return this.enqueue(async () => {
      const map = await this.readMap()
      if (!(provider in map)) return
      delete map[provider]
      await this.writeMap(map)
    })
  }
}

export function createSecretsStore(options: SecretsStoreOptions): SecretsStore {
  return new SecretsStore(options)
}

let defaultStore: SecretsStore | null = null

function getDefaultStore(): SecretsStore {
  if (!defaultStore) {
    defaultStore = new SecretsStore({
      filePath: join(app.getPath('userData'), 'secrets.enc'),
      safeStorage
    })
  }
  return defaultStore
}

export function setSecretKey(provider: AIProviderId, apiKey: string): Promise<void> {
  return getDefaultStore().setKey(provider, apiKey)
}

export function hasSecretKey(provider: AIProviderId): Promise<boolean> {
  return getDefaultStore().hasKey(provider)
}

export function deleteSecretKey(provider: AIProviderId): Promise<void> {
  return getDefaultStore().deleteKey(provider)
}

/**
 * Main-process only secret accessor. Never expose via IPC or preload.
 */
export function getSecretKey(provider: AIProviderId): Promise<string | null> {
  return getDefaultStore().getKey(provider)
}

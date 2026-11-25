import { copyFile, mkdir } from 'fs/promises'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { build } from 'esbuild'

const __dirname = dirname(fileURLToPath(import.meta.url))
const srcDir = resolve(__dirname, 'src')
const distDir = resolve(__dirname, 'dist')
const rootIcon = resolve(__dirname, '../build/icon.png')

await mkdir(distDir, { recursive: true })

await Promise.all([
  build({
    entryPoints: [resolve(srcDir, 'background.ts')],
    outfile: resolve(distDir, 'background.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome116',
    sourcemap: false
  }),
  build({
    entryPoints: [resolve(srcDir, 'content.ts')],
    outfile: resolve(distDir, 'content.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'chrome116',
    sourcemap: false
  }),
  build({
    entryPoints: [resolve(srcDir, 'popup.ts')],
    outfile: resolve(distDir, 'popup.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: 'chrome116',
    sourcemap: false
  })
])

await Promise.all([
  copyFile(resolve(__dirname, 'manifest.json'), resolve(distDir, 'manifest.json')),
  copyFile(resolve(srcDir, 'popup.html'), resolve(distDir, 'popup.html')),
  copyFile(rootIcon, resolve(distDir, 'icon.png'))
])

console.log('Built extension into extension/dist/')


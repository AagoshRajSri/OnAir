const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

function findRcedit(cacheRoot) {
  if (!fs.existsSync(cacheRoot)) return null
  for (const entry of fs.readdirSync(cacheRoot)) {
    const candidate = path.join(cacheRoot, entry, 'rcedit-x64.exe')
    if (fs.existsSync(candidate)) return candidate
  }
  return null
}

function findWinCodeSignArchive(cacheRoot) {
  if (!fs.existsSync(cacheRoot)) return null
  for (const entry of fs.readdirSync(cacheRoot)) {
    if (entry.endsWith('.7z')) return path.join(cacheRoot, entry)
  }
  return null
}

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return

  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const iconPath = path.resolve(__dirname, 'icon.ico')
  const sevenZip = path.resolve(__dirname, '../node_modules/7zip-bin/win/x64/7za.exe')
  const localAppData = process.env.LOCALAPPDATA || ''
  const cacheRoot = path.join(localAppData, 'electron-builder', 'Cache', 'winCodeSign')
  const toolDir = path.join(cacheRoot, 'rcedit-only')
  let rceditExe = findRcedit(cacheRoot)

  if (!rceditExe) {
    let archive = findWinCodeSignArchive(cacheRoot)
    if (!archive) {
      // Trigger app-builder download of winCodeSign archive into cacheRoot
      const appBuilder = path.resolve(__dirname, '../node_modules/app-builder-bin/win/x64/app-builder.exe')
      try {
        execFileSync(appBuilder, ['rcedit', '--args', JSON.stringify([exePath, '--set-icon', iconPath])], {
          env: { ...process.env, PATH: `${path.dirname(sevenZip)};${process.env.PATH || ''}` },
          stdio: 'ignore'
        })
      } catch {
        // Expected on Windows without Developer Mode due to darwin symlinks in archive
      }
      archive = findWinCodeSignArchive(cacheRoot)
    }

    if (archive) {
      fs.mkdirSync(toolDir, { recursive: true })
      execFileSync(sevenZip, ['e', archive, `-o${toolDir}`, 'rcedit-x64.exe', '-y'], {
        stdio: 'inherit'
      })
      rceditExe = path.join(toolDir, 'rcedit-x64.exe')
    }
  }

  if (!rceditExe || !fs.existsSync(rceditExe)) {
    throw new Error('Could not locate rcedit-x64.exe to embed Windows application icon')
  }

  execFileSync(rceditExe, [exePath, '--set-icon', iconPath], { stdio: 'inherit' })
}

const path = require('path')
const { execFileSync } = require('child_process')

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return
  const exePath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.exe`)
  const iconPath = path.resolve(__dirname, 'icon.ico')
  const appBuilder = path.resolve(__dirname, '../node_modules/app-builder-bin/win/x64/app-builder.exe')
  execFileSync(appBuilder, ['rcedit', '--args', JSON.stringify([exePath, '--set-icon', iconPath])], {
    stdio: 'inherit'
  })
}

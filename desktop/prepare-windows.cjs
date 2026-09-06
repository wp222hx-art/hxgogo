// Recreate the copied runtime before resource editing; Windows may briefly retain the copied image.
const fs = require('node:fs/promises')
const path = require('node:path')
module.exports = async ({ appOutDir }) => {
  if (process.platform !== 'win32') return
  const root = path.resolve(__dirname, '..'), target = path.resolve(appOutDir)
  const relative = path.relative(root, target)
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Build output must be inside the project')
  const executable = path.join(target, 'electron.exe')
  const staged = path.join(target, 'electron.exe.' + process.pid + '.staged')
  const bytes = await fs.readFile(executable)
  await fs.writeFile(staged, bytes, { flag: 'wx' })
  await fs.unlink(executable)
  await fs.rename(staged, executable)
  await new Promise(resolve => setTimeout(resolve, 5000))
}

const { existsSync, readFileSync, writeFileSync, renameSync } = require('node:fs')

// Windows DPAPI via Electron: keys are decryptable only by this OS user.
module.exports = function createVault(file, safeStorage) {
  const allowed = new Set(['OPENAI_API_KEY', 'DEEPSEEK_API_KEY'])
  function load() {
    if (!existsSync(file)) return {}
    if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密服务不可用')
    return JSON.parse(safeStorage.decryptString(readFileSync(file)))
  }
  return {
    load,
    save(patch) {
      if (!safeStorage.isEncryptionAvailable()) throw new Error('系统密钥加密服务不可用，未保存密钥')
      const values = load()
      for (const [key, value] of Object.entries(patch)) {
        if (!allowed.has(key)) throw new Error('Unsupported secret key')
        if (value) values[key] = String(value).trim()
        else delete values[key]
      }
      writeFileSync(file + '.tmp', safeStorage.encryptString(JSON.stringify(values)))
      renameSync(file + '.tmp', file)
    }
  }
}

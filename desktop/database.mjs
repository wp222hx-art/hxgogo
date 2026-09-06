import { DatabaseSync, backup } from 'node:sqlite'
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

// Preserve the D1 contract used by the application, including atomic batches.
export class LocalDatabase {
  constructor(path, migrations) {
    mkdirSync(dirname(path), { recursive: true })
    this.native = new DatabaseSync(path)
    this.native.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA secure_delete=ON; PRAGMA busy_timeout=5000;')
    this.native.exec('CREATE TABLE IF NOT EXISTS desktop_migrations (name TEXT PRIMARY KEY, applied_ms INTEGER NOT NULL)')
    try {
      for (const name of readdirSync(migrations).filter(n => n.endsWith('.sql')).sort()) {
        if (this.native.prepare('SELECT 1 FROM desktop_migrations WHERE name=?').get(name)) continue
        this.native.exec('BEGIN IMMEDIATE')
        try {
          this.native.exec(readFileSync(join(migrations, name), 'utf8'))
          this.native.prepare('INSERT INTO desktop_migrations VALUES (?, ?)').run(name, Date.now())
          this.native.exec('COMMIT')
        } catch (e) { this.native.exec('ROLLBACK'); throw e }
      }
      // An explicit provider choice is required before automatic AI calls.
      this.native.prepare("INSERT OR IGNORE INTO app_config VALUES ('AI_PROVIDER','disabled',?)").run(Date.now())
    } catch (e) { this.native.close(); throw e }
  }
  prepare(sql) { return new LocalStatement(this, sql) }
  async batch(statements) {
    this.native.exec('BEGIN IMMEDIATE')
    try {
      const results = statements.map(s => {
        if (s.db !== this) throw new Error('Statement belongs to another database')
        return s.execute()
      })
      this.native.exec('COMMIT')
      return results
    } catch (e) { this.native.exec('ROLLBACK'); throw e }
  }
  async backup(path) { await backup(this.native, path) }
  close() { this.native.close() }
}

class LocalStatement {
  constructor(db, sql, args = []) { this.db = db; this.sql = sql; this.args = args }
  bind(...args) { return new LocalStatement(this.db, this.sql, args) }
  statement() { return this.db.native.prepare(this.sql) }
  execute() {
    const stmt = this.statement()
    if (stmt.columns().length) return { success: true, results: stmt.all(...this.args), meta: { changes: 0 } }
    const r = stmt.run(...this.args)
    return { success: true, results: [], meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }
  }
  async first(column) { const row = this.statement().get(...this.args); return row ? (column ? row[column] : row) : null }
  async all() { return { success: true, results: this.statement().all(...this.args), meta: {} } }
  async run() { return this.execute() }
}

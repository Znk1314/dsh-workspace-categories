// Run with ELECTRON_RUN_AS_NODE=1 <electron> dump.js <srcDir> <destDir>
const fs = require('node:fs')
const path = require('node:path')

const [, , srcDir, destDir] = process.argv
if (!srcDir || !destDir) {
  console.error('usage: dump.js <srcDir> <destDir>')
  process.exit(1)
}

const skipDirs = new Set(['node_modules', '.git'])
let copied = 0
let total = 0

function walk(src, dest) {
  let entries
  try {
    entries = fs.readdirSync(src, { withFileTypes: true })
  } catch (error) {
    console.error('skip ' + src + ': ' + error.message)
    return
  }
  for (const entry of entries) {
    if (skipDirs.has(entry.name)) continue
    const from = path.join(src, entry.name)
    const to = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      walk(from, to)
      continue
    }
    let stat
    try {
      stat = fs.statSync(from)
    } catch {
      continue
    }
    total += stat.size
    if (total > 40 * 1024 * 1024) {
      console.error('size cap reached')
      process.exit(2)
    }
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.copyFileSync(from, to)
    copied++
  }
}

walk(srcDir, destDir)
console.log('copied ' + copied + ' files')

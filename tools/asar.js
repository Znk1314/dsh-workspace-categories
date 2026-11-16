// Run with: ELECTRON_RUN_AS_NODE=1 "<DeepSeek Harness.exe>" tools/asar.js <command> [...args]
// command: ls <dir> | read <file> [startLine] [lineCount] | grep <dir> <literal> [maxHits]
const fs = require('node:fs')
const path = require('node:path')

const [, , command, ...rest] = process.argv

function ls(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const e of entries.slice(0, 400)) {
    console.log(e.isDirectory() ? e.name + '/' : e.name)
  }
  if (entries.length > 400) console.log('... ' + (entries.length - 400) + ' more')
}

function read(file, startLine, lineCount) {
  const text = fs.readFileSync(file, 'utf8')
  const lines = text.split(/\r?\n/)
  const start = startLine ? Math.max(0, Number(startLine) - 1) : 0
  const count = lineCount ? Number(lineCount) : lines.length
  lines.slice(start, start + count).forEach((l, i) => {
    console.log(String(start + i + 1).padStart(5) + '  ' + l)
  })
}

function grep(dir, term, maxHits) {
  const limit = Number(maxHits || 20)
  let hits = 0
  const stack = [dir]
  while (stack.length && hits < limit) {
    const current = stack.pop()
    let entries
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      if (hits >= limit) break
      const full = path.join(current, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue
        stack.push(full)
        continue
      }
      if (!/\.(m?js|json|ts|tsx|css|md|yml)$/.test(e.name)) continue
      let stat
      try {
        stat = fs.statSync(full)
      } catch {
        continue
      }
      if (stat.size > 2 * 1024 * 1024) continue
      let text
      try {
        text = fs.readFileSync(full, 'utf8')
      } catch {
        continue
      }
      if (!text.includes(term)) continue
      const lines = text.split(/\r?\n/)
      lines.forEach((line, index) => {
        if (hits >= limit) return
        if (!line.includes(term)) return
        hits++
        console.log(full + ':' + (index + 1) + ': ' + line.slice(0, 200))
      })
    }
  }
  if (hits >= limit) console.log('... truncated at ' + limit + ' hits')
}

switch (command) {
  case 'ls':
    ls(rest[0])
    break
  case 'read':
    read(rest[0], rest[1], rest[2])
    break
  case 'grep':
    grep(rest[0], rest[1], rest[2])
    break
  default:
    console.log('unknown command')
    process.exitCode = 1
}

// Verify every t('key') used in client.js exists in both dictionaries.
const fs = require('node:fs')
const text = fs.readFileSync(process.argv[2], 'utf8')

const used = new Set()
for (const match of text.matchAll(/(?<![A-Za-z0-9_$.])t\('([a-zA-Z][a-zA-Z0-9_.]+)'/g)) used.add(match[1])
// Dynamic colour keys: t(`color.${color}`)
for (const color of ['brand', 'blue', 'green', 'amber', 'violet', 'rose', 'slate']) used.add('color.' + color)

const zhStart = text.indexOf('const zh = {')
const enStart = text.indexOf('const en = {')
const zhBlock = text.slice(zhStart, enStart)
const enBlock = text.slice(enStart, text.indexOf('/* ----', enStart))

const keysOf = (block) => new Set([...block.matchAll(/'([a-zA-Z][a-zA-Z0-9_.]+)':\s*'/g)].map(m => m[1]))
const zh = keysOf(zhBlock)
const en = keysOf(enBlock)

const missingZh = [...used].filter(k => !zh.has(k))
const missingEn = [...used].filter(k => !en.has(k))
console.log('used keys:', used.size, '| zh:', zh.size, '| en:', en.size)
console.log('missing in zh:', missingZh.length ? missingZh.join(', ') : 'none')
console.log('missing in en:', missingEn.length ? missingEn.join(', ') : 'none')
const onlyZh = [...zh].filter(k => !en.has(k))
const onlyEn = [...en].filter(k => !zh.has(k))
console.log('zh-only:', onlyZh.length ? onlyZh.join(', ') : 'none')
console.log('en-only:', onlyEn.length ? onlyEn.join(', ') : 'none')
const unused = [...zh].filter(k => !used.has(k))
console.log('defined but unused:', unused.length ? unused.join(', ') : 'none')

// Confirm every zh value is pure ASCII source (escaped) so no encoding drift can hit it.
const nonAscii = [...zhBlock].filter(ch => ch.charCodeAt(0) > 127)
console.log('non-ascii chars in zh block:', nonAscii.length ? JSON.stringify(nonAscii.join('')) : 'none')

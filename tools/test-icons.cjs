// Verify the icon system: every glyph is well-formed, the browser and Host
// agree on the vocabulary, the defaults are real ids, and the fold is driven by
// the folder icon itself rather than a separate chevron.
const fs = require('node:fs')

const client = fs.readFileSync(process.argv[2], 'utf8')
const host = fs.readFileSync(process.argv[3], 'utf8')
let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures++
  console.log('FAIL ' + label + '\n  got      ' + JSON.stringify(actual) + '\n  expected ' + JSON.stringify(expected))
}
const ok = (label, condition) => check(label, Boolean(condition), true)

// --- extract the browser's glyph table -------------------------------------
const tableStart = client.indexOf('const GLYPHS = {')
const tableEnd = client.indexOf('\n    }', tableStart)
ok('glyph table found', tableStart !== -1 && tableEnd !== -1)
const table = client.slice(tableStart, tableEnd)

const ids = [...table.matchAll(/^\s{6}(\w+):\s*\[/gm)].map(m => m[1])
ok('glyph table is non-trivial (' + ids.length + ' icons)', ids.length >= 20)
check('glyph ids are unique', ids.length, new Set(ids).size)

// Every entry must be a non-empty array of path strings on the 16-unit grid.
/* Path data mixes absolute commands (whose coordinates are in the 0..16 box)
   with relative ones (whose numbers are offsets and legitimately exceed it), so
   a numeric range check would be a false positive. Validate the grammar and the
   absolute start point instead. */
const COMMANDS = new Set(['M', 'm', 'L', 'l', 'H', 'h', 'V', 'v', 'C', 'c', 'S', 's', 'Q', 'q', 'T', 't', 'A', 'a', 'Z', 'z'])
for (const id of ids) {
  const entry = new RegExp('\\n\\s{6}' + id + ':\\s*\\[([\\s\\S]*?)\\]').exec(table)
  ok('glyph "' + id + '" parses', entry !== null)
  if (entry === null) continue
  const paths = [...entry[1].matchAll(/'([^']+)'/g)].map(m => m[1])
  ok('glyph "' + id + '" has at least one path', paths.length >= 1)
  for (const d of paths) {
    ok('glyph "' + id + '" starts with a move command', /^[Mm]/.test(d.trim()))
    const letters = (d.match(/[A-Za-z]/g) ?? [])
    const unknown = letters.filter(letter => !COMMANDS.has(letter))
    ok('glyph "' + id + '" uses only SVG path commands (' + unknown.join('') + ')', unknown.length === 0)
    ok('glyph "' + id + '" has no NaN', !/NaN/.test(d))
    /* The absolute start point of each subpath must be inside the viewBox. */
    for (const start of d.matchAll(/[Mm]\s*(-?[\d.]+)[ ,]+(-?[\d.]+)/g)) {
      const x = Number(start[1])
      const y = Number(start[2])
      ok('glyph "' + id + '" starts inside the box (' + x + ',' + y + ')', x >= 0 && x <= 16 && y >= 0 && y <= 16)
    }
  }
}

// --- browser and Host must agree on the vocabulary --------------------------
const hostGlyphs = [...host.matchAll(/'([a-z]+)'/g)].map(m => m[1])
const hostSet = new Set(
  (/const GLYPHS = new Set\(\[([\s\S]*?)\]\)/.exec(host)?.[1] ?? '')
    .matchAll(/'([a-z]+)'/g).next ? [...(/const GLYPHS = new Set\(\[([\s\S]*?)\]\)/.exec(host)?.[1] ?? '').matchAll(/'([a-z]+)'/g)].map(m => m[1]) : [],
)
void hostGlyphs
ok('Host declares a glyph whitelist', hostSet.size > 0)
const missingInHost = ids.filter(id => !hostSet.has(id))
const extraInHost = [...hostSet].filter(id => !ids.includes(id))
check('every browser glyph is whitelisted by the Host', missingInHost, [])
check('the Host whitelists no glyph the browser lacks', extraInHost, [])

// --- palette parity ---------------------------------------------------------
const browserColors = [...(/const COLORS = \[([^\]]+)\]/.exec(client)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1])
const hostColors = [...(/const COLORS = new Set\(\[([^\]]+)\]/.exec(host)?.[1] ?? '').matchAll(/'(\w+)'/g)].map(m => m[1])
check('palette has nine swatches', browserColors.length, 9)
check('Host palette matches the browser palette', hostColors, browserColors)

// Every palette and glyph needs copy in both dictionaries.
const usedColorKeys = browserColors.map(c => "'color." + c + "':")
for (const key of usedColorKeys) {
  ok('zh has ' + key, client.includes(key))
}
const zhBlock = client.slice(client.indexOf('const zh = {'), client.indexOf('const en = {'))
const enBlock = client.slice(client.indexOf('const en = {'), client.indexOf('/* ----', client.indexOf('const en = {')))
for (const key of usedColorKeys) ok('zh dictionary declares ' + key, zhBlock.includes(key))
for (const key of usedColorKeys) ok('en dictionary declares ' + key, enBlock.includes(key))

// --- defaults and fold wiring ----------------------------------------------
ok('DEFAULT_GLYPH is a real id', ids.includes(/const DEFAULT_GLYPH = '(\w+)'/.exec(client)?.[1]))
ok('normalize rejects unknown icons via GLYPH_IDS', /icon: GLYPH_IDS\.includes\(category\.icon\) \? category\.icon : DEFAULT_GLYPH/.test(client))
ok('normalize falls back to ink', /color: COLORS\.includes\(category\.color\) \? category\.color : 'ink'/.test(client))
ok('a new category gets an icon', /icon: DEFAULT_GLYPH/.test(client))

// The workspace fold must render the folder shapes, not a chevron.
ok('a closed folder shape exists', /const FOLDER_CLOSED = /.test(client))
ok('an open folder shape exists', /const FOLDER_OPEN = \[/.test(client))
ok('the workspace fold renders folderOpen when expanded',
  /folded \? ICON\.folderClosed\(14\) : ICON\.folderOpen\(14\)/.test(client))
ok('the workspace fold toggles the fold', /toggleWorkspaceCollapsed/.test(client))
ok('the category glyph toggles the fold',
  /wsx-cat-glyph[\s\S]{0,200}toggleCategoryCollapsed|toggleCategoryCollapsed\(category\.id\)/.test(client))
ok('no chevron icon remains', !/ICON\.chevron/.test(client))
ok('no chevron CSS remains', !/\.wsx-chevron/.test(client))

// --- appearance picker ------------------------------------------------------
ok('an appearance dialog kind exists', /kind: 'appearance'/.test(client))
ok('the picker renders a swatch grid', /wsx-swatches/.test(client))
ok('the picker renders a glyph grid', /wsx-glyphgrid/.test(client))
ok('picking applies icon and colour immediately',
  /setCategoryColor\(category\.id, draft\.color\)[\s\S]{0,120}setCategoryIcon\(category\.id, draft\.icon\)/.test(client))
ok('the category menu opens the picker', /id: 'appearance'/.test(client))

console.log(
  'vocabulary: ' + ids.length + ' glyphs, ' + browserColors.length + ' colours, '
  + 'Host whitelist ' + hostSet.size + ' glyphs',
)
console.log(failures === 0 ? 'ALL ICON CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

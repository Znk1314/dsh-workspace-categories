// Verify the three-level geometry: a category bar, the workspace rows inside it,
// and those workspaces' session rows. Sessions now carry no leading marker, so
// the invariant is that a session title starts on the workspace title column and
// the indent guide spans exactly the icon gap.
const fs = require('node:fs')

const css = fs.readFileSync(process.argv[2], 'utf8')
let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures++
  console.log('FAIL ' + label + '\n  got      ' + actual + '\n  expected ' + expected)
}
const ok = (label, condition) => check(label, Boolean(condition), true)

const number = (name) => {
  const match = css.match(new RegExp('--' + name + ':\\s*([\\d.]+)px'))
  if (match === null) throw new Error('missing custom property --' + name)
  return Number(match[1])
}

const pad = number('wsx-row-pad')
const icon = number('wsx-icon-w')
const gap = number('wsx-row-gap')
const insetMatch = css.match(/--wsx-icon-col:\s*calc\(var\(--wsx-row-pad\)\s*\+\s*([\d.]+)px\)/)
if (insetMatch === null) throw new Error('--wsx-icon-col is not row-pad plus an inset')
const iconCol = pad + Number(insetMatch[1])
const titleCol = iconCol + icon + gap

// The session row must have no leading marker and start flush inside the guide,
// so its title lands on the workspace title column.
const sessionRule = css.match(/\.wsx-session\s*\{([\s\S]*?)\}/)
if (sessionRule === null) throw new Error('missing .wsx-session rule')
ok('session row has no left padding of its own', /padding:\s*0 8px 0 0/.test(sessionRule[1]))
check('no status dot rule exists', /\.wsx-dot\b/.test(css), false)
check('no session marker rule exists', /\.wsx-session-marker/.test(css), false)

// The guide's left margin plus padding must equal the title column, so the
// guide line sits in the icon slot and the text after it starts on the title.
const guideRule = css.match(/\.wsx-guide\s*\{([\s\S]*?)\}/)
if (guideRule === null) throw new Error('missing .wsx-guide rule')
const marginLeft = /margin-left:\s*var\(--wsx-icon-col\)/.exec(guideRule[1])
ok('guide starts on the icon column', marginLeft !== null)
const guidePad = /padding-left:\s*calc\(var\(--wsx-icon-w\)\s*\+\s*var\(--wsx-row-gap\)\s*-\s*([\d.]+)px\)/.exec(guideRule[1])
ok('guide padding is the icon width plus the gap', guidePad !== null)
const guideBorder = /border-left:\s*([\d.]+)px solid/.exec(guideRule[1])
ok('guide draws a left border', guideBorder !== null)
const sessionTitleStart = iconCol + (icon + gap - Number(guidePad[1])) + Number(guideBorder[1])
check('session title starts on the workspace title column', sessionTitleStart, titleCol)

// The category bar is compact: a fixed head height and no box padding.
const barRule = css.match(/\.wsx-bar\s*\{([\s\S]*?)\}/)
if (barRule === null) throw new Error('missing .wsx-bar rule')
ok('a category is a bar with an accent strip', /::before/.test(css))
const stripRule = css.match(/\.wsx-bar::before\s*\{([\s\S]*?)\}/)
if (stripRule === null) throw new Error('missing .wsx-bar::before rule')
ok('the strip is a thin vertical bar', /width:\s*3px/.test(stripRule[1]))
ok('the strip is tinted by the accent', /background:\s*var\(--wsx-accent\)/.test(stripRule[1]))
const headRule = css.match(/\.wsx-cat-head\s*\{([\s\S]*?)\}/)
if (headRule === null) throw new Error('missing .wsx-cat-head rule')
ok('the bar head is compact (<=36px)', Number(/height:\s*(\d+)px/.exec(headRule[1])?.[1]) <= 36)
/* The category itself must not carry a box border any more: the accent strip is
   the only chrome. Scope the check to .wsx-cat's own rule. */
const catRule = css.match(/\n\.wsx-cat\s*\{([\s\S]*?)\}/)
if (catRule === null) throw new Error('missing .wsx-cat rule')
ok('the category has no surrounding box border', !/border:/.test(catRule[1]))

// Category type is larger than before, and its glyph bigger than the folder.
const catName = css.match(/\.wsx-cat-name\s*\{([\s\S]*?)\}/)
if (catName === null) throw new Error('missing .wsx-cat-name rule')
ok('category name is 14px', /font-size:\s*14px/.test(catName[1]))
ok('category glyph renders at 18px', /glyphById\(category\.icon, 18\)/.test(fs.readFileSync(process.argv[3], 'utf8')))
ok('the folder icon renders at 15px', /ICON\.folderOpen\(15\)/.test(fs.readFileSync(process.argv[3], 'utf8')))

// Tabs and the recent strip exist and are styled.
ok('tabs are a segmented control', /\.wsx-tabs[\s\S]*?display:\s*flex/.test(css))
ok('the selected tab is marked', /\.wsx-tab-on\s*\{/.test(css))
ok('recent chips exist', /\.wsx-chip\s*\{/.test(css))
ok('the footer bar is visually demoted', /\.wsx-bar-footer\s*\{[\s\S]*?background:\s*transparent/.test(css))

// Nine tones still exist.
for (const tone of ['ink', 'red', 'orange', 'amber', 'green', 'blue', 'violet', 'pink', 'slate']) {
  ok('.wsx-tone-' + tone + ' exists', new RegExp('\\.wsx-tone-' + tone + '\\s*\\{').test(css))
}

console.log('columns: icon=' + iconCol + 'px title=' + titleCol + 'px; guide line at ' + iconCol + 'px')
console.log(failures === 0 ? 'ALL ALIGNMENT CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

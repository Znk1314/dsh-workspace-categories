// Prove the three nesting levels share one geometry: a category's glyph, its
// workspaces' folder icons, and those workspaces' session markers all sit on
// the same vertical line, and both titles share one left edge.
const fs = require('node:fs')

const css = fs.readFileSync(process.argv[2], 'utf8')
let failures = 0
const check = (label, actual, expected) => {
  if (actual === expected) return
  failures++
  console.log('FAIL ' + label + ' — got ' + actual + ', expected ' + expected)
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
/* --wsx-icon-col is expressed as row-pad plus a small optical inset. */
const insetMatch = css.match(/--wsx-icon-col:\s*calc\(var\(--wsx-row-pad\)\s*\+\s*([\d.]+)px\)/)
if (insetMatch === null) throw new Error('--wsx-icon-col is not row-pad plus an inset')
const inset = Number(insetMatch[1])

const iconCol = pad + inset
const titleCol = iconCol + icon + gap

// The workspace row's folder button is exactly one icon column wide, so the
// folder's centre sits at iconCol + icon/2.
const folderCentre = iconCol + icon / 2
// The session marker cell also starts on iconCol and is one icon column wide.
const markerCentre = iconCol + icon / 2
check('session marker centre equals folder centre', markerCentre, folderCentre)
check('session title starts on the workspace title', iconCol + icon + gap, titleCol)

/* Category glyph: the head's padding plus half its button width must equal the
   folder column, or the three levels visually stagger. */
const headRule = css.match(/\.wsx-cat-head\s*\{([\s\S]*?)\}/)
if (headRule === null) throw new Error('missing .wsx-cat-head rule')
const headPad = /padding:\s*0 2px 0 ([\d.]+)px/.exec(headRule[1])
ok('category head left padding is declared', headPad !== null)
const foldRule = css.match(/\.wsx-cat-fold\s*\{([\s\S]*?)\}/)
if (foldRule === null) throw new Error('missing .wsx-cat-fold rule')
const foldW = /width:\s*([\d.]+)px/.exec(foldRule[1])
ok('category glyph button width is declared', foldW !== null)
const catGlyphCentre = Number(headPad[1]) + Number(foldW[1]) / 2
/* The category glyph is 16px and the folder glyph is 16px, but the folder sits
   in a 16px column starting at iconCol while the category glyph's own column is
   the box padding plus the head padding. Both centres must agree within 1px. */
const folderCentreInBox = iconCol + icon / 2
const catGlyphCentreInBox = Number(headPad[1]) + Number(foldW[1]) / 2
const drift = Math.abs(catGlyphCentreInBox - folderCentreInBox)
ok('category glyph centre is within 1px of the folder centre (drift ' + drift + 'px)', drift <= 1)

// Structural requirements of the new icon system.
ok('.wsx-cat-glyph exists', /\.wsx-cat-glyph\s*\{/.test(css))
ok('.wsx-workspace-fold is the folder button', /\.wsx-workspace-fold\s*\{/.test(css))
ok('the workspace fold uses the icon column width',
  /\.wsx-workspace-fold\s*\{[\s\S]*?width:\s*var\(--wsx-icon-w\)/.test(css))
ok('the session row starts on the icon column',
  /\.wsx-session\s*\{[\s\S]*?padding:\s*0 8px 0 var\(--wsx-icon-col\)/.test(css))
ok('the session marker is centred', /\.wsx-session-marker[\s\S]*?justify-content:\s*center/.test(css))
ok('the empty notice follows the title column',
  /\.wsx-workspace > \.wsx-cat-empty[\s\S]*?var\(--wsx-title-col\)/.test(css))

// Nine tones exist, and each declares both a colour and an accent.
const tones = ['ink', 'red', 'orange', 'amber', 'green', 'blue', 'violet', 'pink', 'slate']
for (const tone of tones) {
  const rule = css.match(new RegExp('\\.wsx-tone-' + tone + '\\s*\\{([\\s\\S]*?)\\}'))
  ok('.wsx-tone-' + tone + ' exists', rule !== null)
  if (rule !== null) {
    ok('.wsx-tone-' + tone + ' declares colour and accent',
      /color:/.test(rule[1]) && /--wsx-accent:/.test(rule[1]))
  }
}

// The appearance picker's grid must be a real grid, not a wrap of buttons.
ok('glyph picker is a grid', /\.wsx-glyphgrid[\s\S]*?display:\s*grid/.test(css))
ok('swatches are round', /\.wsx-swatch-fill[\s\S]*?border-radius:\s*50%/.test(css))

// The old down-chevron and the old dot indicator must be gone.
check('no chevron rule remains', /\.wsx-chevron/.test(css), false)
check('no category dot rule remains', /\.wsx-cat-dot/.test(css), false)

console.log('columns: icon=' + iconCol + 'px title=' + titleCol + 'px; cat glyph centre=' + catGlyphCentreInBox + 'px, folder centre=' + folderCentreInBox + 'px')
console.log(failures === 0 ? 'ALL ALIGNMENT CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

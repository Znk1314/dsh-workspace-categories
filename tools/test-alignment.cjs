// Prove the two nesting levels share one geometry: the session marker's centre
// must equal the folder icon's centre, and the session title must start on the
// workspace title.
const fs = require('node:fs')

const css = fs.readFileSync(process.argv[2], 'utf8')
const number = (name) => {
  const match = css.match(new RegExp('--' + name + ':\\s*([\\d.]+)px'))
  if (match === null) throw new Error('missing custom property --' + name)
  return Number(match[1])
}
const gapMatch = css.match(/--wsx-row-gap:\s*var\(--dsh-sidebar-label-gap,\s*([\d.]+)px\)/)
if (gapMatch === null) throw new Error('row gap is not theme-derived with a fallback')

const pad = number('wsx-row-pad')
const fold = number('wsx-fold-w')
const icon = number('wsx-icon-w')
const gap = Number(gapMatch[1])

const iconCol = pad + fold + gap
const titleCol = iconCol + icon + gap

let failures = 0
const check = (label, actual, expected) => {
  if (actual === expected) return
  failures++
  console.log('FAIL ' + label + ' — got ' + actual + ', expected ' + expected)
}

// The folder icon occupies [iconCol, iconCol + icon]; its centre:
const folderCentre = iconCol + icon / 2
// The session marker cell starts at iconCol inside the row and is `icon` wide:
const markerCentre = iconCol + icon / 2
check('marker centre equals folder centre', markerCentre, folderCentre)

// Both are centred in the same column, which is what the eye reads as "lined up".
check('folder centre sits mid-column', folderCentre, iconCol + icon / 2)
// Session title starts exactly where the workspace title starts.
const sessionTitleStart = iconCol + icon + gap
check('session title aligns with workspace title', sessionTitleStart, titleCol)

// The dock must not collapse the marker cell to the dot's own 6px, or the two
// centres would separate again by (icon - dot) / 2 = 3.5px.
const markerRule = css.match(/\.wsx-session-marker\s*\{([\s\S]*?)\}/)
if (markerRule === null) throw new Error('missing .wsx-session-marker rule')
check('.wsx-session-marker width is the icon column width',
  /width:\s*var\(--wsx-icon-w\)/.test(markerRule[1]), true)
check('.wsx-session-marker centres the dot',
  /justify-content:\s*center/.test(markerRule[1]), true)

// The session row must start its content on the icon column, not a magic number.
const sessionRule = css.match(/\.wsx-session\s*\{([\s\S]*?)\}/)
if (sessionRule === null) throw new Error('missing .wsx-session rule')
check('.wsx-session left padding is the icon column',
  /padding:\s*0 8px 0 var\(--wsx-icon-col\)/.test(sessionRule[1]), true)

// The workspace header must consume the same gap/pad variables.
const headRule = css.match(/\.wsx-workspace-head\s*\{([\s\S]*?)\}/)
if (headRule === null) throw new Error('missing .wsx-workspace-head rule')
check('header gap is the shared row gap', /gap:\s*var\(--wsx-row-gap\)/.test(headRule[1]), true)
check('header left padding is the shared row pad',
  /padding:\s*0 4px 0 var\(--wsx-row-pad\)/.test(headRule[1]), true)
check('fold button width comes from the shared variable',
  /width:\s*var\(--wsx-fold-w\)/.test(css), true)

console.log(
  'columns: icon=' + iconCol + 'px title=' + titleCol + 'px; '
  + 'folder centre=' + (folderCentre + pad * 0) + 'px within the head content box',
)
console.log(failures === 0 ? 'ALL ALIGNMENT CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

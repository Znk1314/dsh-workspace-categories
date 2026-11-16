// Verify the corrected layout:
//  1. tone classes carry only a custom property — they must never set `color` on
//     the bar, or the accent inherits into every title (the reported bug);
//  2. a category is one rounded, light tinted band — not a left colour strip;
//  3. workspace titles and session titles share one left edge.
const fs = require('node:fs')

const source = process.argv[2]
const css = fs.readFileSync(source, 'utf8')
let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures++
  console.log('FAIL ' + label + '\n  got      ' + actual + '\n  expected ' + expected)
}
const ok = (label, condition) => check(label, Boolean(condition), true)

const rule = (selector) => {
  const match = new RegExp('\\n' + selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([\\s\\S]*?)\\}').exec(css)
  if (match === null) throw new Error('missing rule: ' + selector)
  return match[1]
}

// --- 1. colour must not leak into text -------------------------------------
const tones = ['ink', 'red', 'orange', 'amber', 'green', 'blue', 'violet', 'pink', 'slate']
for (const tone of tones) {
  const body = rule('.wsx-tone-' + tone)
  ok('.wsx-tone-' + tone + ' declares an accent', /--wsx-accent:/.test(body))
  ok('.wsx-tone-' + tone + ' declares no color property', !/(^|;|\s)color:/.test(body))
}
// The name and both title rows must pin their own ink.
for (const selector of ['.wsx-cat-name', '.wsx-workspace-title', '.wsx-session-title']) {
  const body = rule(selector)
  const explicit = /color:\s*var\(--dsw-alias-label-primary\)/.test(body)
  const inherits = !/(^|;|\s)color:/.test(body)
  ok(selector + ' pins its own ink (explicit or by not setting color)', explicit || inherits)
}
// Only the glyph takes the accent as ink.
ok('the category glyph is accented', /color:\s*var\(--wsx-accent-strong/.test(rule('.wsx-cat-glyph')))

// --- 2. one rounded tinted band, on the category row only ------------------
const bar = rule('.wsx-bar')
check('the block itself carries no fill', /background:/.test(bar), false)
check('the block has no left accent strip', /\.wsx-bar::before/.test(css), false)
const head = rule('.wsx-cat-head')
ok('the category row is rounded', /border-radius:\s*var\(--dsw-radius/.test(head))
ok('the category row is a tint of the accent', /background:\s*color-mix\(in srgb,\s*var\(--wsx-accent\)/.test(head))
/* The workspaces/sessions container must stay untinted, or the fill would cover
   the whole block instead of the category row. */
const body = rule('.wsx-cat-body')
check('the children container is untinted', /background:/.test(body), false)
ok('the footer variant overrides the tint',
  /\.wsx-bar-footer[^{]*\{[^}]*background:\s*var\(--dsw-alias-bg-layer-1\)/.test(css))

// --- 3. the picker previews the accent, not the text ink -------------------
const swatchFill = rule('.wsx-swatch-fill')
ok('swatches read the accent variable', /background:\s*var\(--wsx-accent\)/.test(swatchFill))
check('swatches do not use currentColor', /currentColor/.test(swatchFill), false)
check('the selected ring does not use currentColor', /currentColor/.test(rule('.wsx-swatch.wsx-swatch-on')), false)
const glyphCell = rule('.wsx-glyphcell')
ok('glyph cells preview the accent', /color:\s*var\(--wsx-accent/.test(glyphCell))
/* The picker root must carry the draft tone so the grid resolves the variable. */
ok('the picker root carries the draft tone', /wsx-appearance wsx-tone-\$\{draft\.color\}/.test(css))

// The active tab is a tinted pill rather than plain bolder text.
const tabOn = rule('.wsx-tab-on')
ok('the active tab is tinted', /background:\s*color-mix\(in srgb,\s*var\(--dsw-static-blue-500\)/.test(tabOn))

// The header title and its trailing controls sit on one 24px row.
const headerActions = rule('.wsx-header-actions')
ok('header actions declare a matching height', /height:\s*24px/.test(headerActions))
ok('the header title declares the same line height', /line-height:\s*24px/.test(rule('.wsx-header-title')))

// --- 4. workspace and session titles share one left edge -------------------
const number = (name) => {
  const match = css.match(new RegExp('--' + name + ':\\s*([\\d.]+)px'))
  if (match === null) throw new Error('missing property --' + name)
  return Number(match[1])
}
const wsPad = number('wsx-ws-pad')
const iconW = number('wsx-icon-w')
const gap = number('wsx-row-gap')
const guideX = number('wsx-guide-x')
const titleCol = wsPad + iconW + gap

ok('the workspace head pads to the folder column', new RegExp('padding:\\s*0 4px 0 var\\(--wsx-ws-pad\\)').test(rule('.wsx-workspace-head')))

const guide = rule('.wsx-guide')
ok('the guide starts left of the title column', guideX < titleCol)
const guidePad = /padding-left:\s*calc\(var\(--wsx-title-col\)\s*-\s*var\(--wsx-guide-x\)\s*-\s*([\d.]+)px\)/.exec(guide)
ok('the guide padding carries text to the title column', guidePad !== null)
const guideBorder = /border-left:\s*([\d.]+)px solid/.exec(guide)
ok('the guide draws a border', guideBorder !== null)

const sessionTitleStart = guideX + Number(guideBorder[1]) + (titleCol - guideX - Number(guidePad[1]))
check('session title starts on the workspace title column', sessionTitleStart, titleCol)
ok('the folder column is right of the guide', wsPad > guideX)

// --- 4. the recent strip is gone; the Recent TAB remains -------------------
check('no chip markup remains', /wsx-chip/.test(css), false)
check('no strip markup remains', /wsx-recent-strip/.test(css), false)
check('the Recent tab still exists', /renderRecent\b/.test(css), true)
ok('the tab strip is still rendered', /wsx-tabs/.test(css))

console.log('columns: guide=' + guideX + 'px folder=' + wsPad + 'px title=' + titleCol + 'px')
console.log(failures === 0 ? 'ALL LAYOUT CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

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

// The header places the label and three icon squares on one optical centre line.
const header = rule('.wsx-header')
ok('the header row is a flex row', /display:\s*flex/.test(header))
ok('the header row centres its children', /align-items:\s*center/.test(header))
ok('the header row has a fixed height', /height:\s*var\(--wsx-header-h\)/.test(header))
/* One variable owns the shared box, so the label and the icons cannot drift. */
ok('a shared box variable is declared', /--wsx-header-box:\s*24px/.test(header))
ok('a nudge variable exists for optical correction', /--wsx-header-icon-nudge:/.test(header))
/* A CJK glyph's ink sits below the em box's centre, so the label needs its own
   sub-pixel lift; the two hooks stay independent. */
ok('a label nudge variable exists', /--wsx-header-label-nudge:/.test(header))
ok('the label nudge is negative (lifts the text)', /--wsx-header-label-nudge:\s*-[\d.]+px/.test(header))
const headerTitle = rule('.wsx-header-title')
ok('the label box is the shared box height', /height:\s*var\(--wsx-header-box\)/.test(headerTitle))
/* The label must claim the free space, or the icon group sits beside the text
   instead of on the sidebar's right edge. */
ok('the label grows to push the controls right', /flex:\s*1 1 auto/.test(headerTitle))
ok('the label box centres its text', /align-items:\s*center/.test(headerTitle))
/* The text must not rely on a baseline: its own line box is inside the flex box. */
const headerLabel = rule('.wsx-header-label')
ok('the label text carries its own line box', /line-height:\s*1\.2/.test(headerLabel))
ok('the label applies its optical lift', /transform:\s*translateY\(var\(--wsx-header-label-nudge\)\)/.test(headerLabel))
check('the label box declares no line-height of its own',
  /line-height:/.test(headerTitle), false)

const headerActions = rule('.wsx-header-actions')
ok('the controls use the shared box height', /height:\s*var\(--wsx-header-box\)/.test(headerActions))
ok('the controls do not grow', /flex:\s*0 0 auto/.test(headerActions))
ok('the controls centre on that box', /align-items:\s*center/.test(headerActions))
ok('the controls apply the optical nudge', /transform:\s*translateY\(var\(--wsx-header-icon-nudge\)\)/.test(headerActions))
/* One uniform gap for all three icons. */
const actionGap = /gap:\s*(\d+)px/.exec(headerActions)
ok('one uniform icon gap is declared', actionGap !== null)

const iconBtn = rule('.wsx-icon-btn')
ok('every icon sits in a fixed square', /width:\s*var\(--wsx-header-box\)/.test(iconBtn) && /height:\s*var\(--wsx-header-box\)/.test(iconBtn))
ok('the icon square centres its glyph', /align-items:\s*center/.test(iconBtn) && /justify-content:\s*center/.test(iconBtn))
/* An inline SVG leaves a baseline gap under it; forcing block removes it. */
ok('glyphs inside the square are block-level', /\.wsx-icon-btn > svg\s*\{[\s\S]*?display:\s*block/.test(css))

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

// --- 5. the running spinner is actually visible ----------------------------
/* The row renders a .wsx-spinner element, but a render check alone cannot tell
   whether it has any size or colour. It shipped once with the markup present and
   no CSS at all, so it was invisible. Assert the painting rules exist. */
const spinner = css.match(/\n\.wsx-spinner\s*\{([\s\S]*?)\}/)
ok('a .wsx-spinner rule exists', spinner !== null)
if (spinner !== null) {
  ok('the spinner declares a width', /width:\s*\d+px/.test(spinner[1]))
  ok('the spinner declares a height', /height:\s*\d+px/.test(spinner[1]))
  ok('the spinner is round', /border-radius:\s*50%/.test(spinner[1]))
  ok('the spinner has a visible ring', /border:\s*[\d.]+px solid/.test(spinner[1]))
  ok('the spinner animates', /animation:\s*wsx-spin/.test(spinner[1]))
}
ok('the spin keyframes exist', /@keyframes wsx-spin\s*\{/.test(css))
ok('the keyframes rotate', /@keyframes wsx-spin[\s\S]{0,160}rotate\(360deg\)/.test(css))
ok('reduced motion is honoured', /prefers-reduced-motion[\s\S]{0,400}\.wsx-spinner/.test(css))
/* The element must be emitted by the row, not merely styled. */
ok('the row emits the spinner', /className:\s*'wsx-spinner'/.test(css))
ok('the spinner branch replaces the timestamp',
  /running\s*\n\s*\? h\('span', \{\s*\n\s*className: 'wsx-spinner'/.test(css))

// --- 6. the section label matches the search field's left edge -------------
const headerRule = rule('.wsx-header')
ok('the header declares a shared inline edge', /--wsx-inline-left:/.test(headerRule))
ok('the header pads from that edge', /padding:\s*0 var\(--wsx-inline-left\)/.test(headerRule))
/* The label is primary ink, so it reads as a title rather than a hint. */
ok('the section label uses primary ink',
  /\.wsx-header-title\s*\{[\s\S]*?color:\s*var\(--dsw-alias-label-primary\)/.test(css))

console.log('columns: guide=' + guideX + 'px folder=' + wsPad + 'px title=' + titleCol + 'px')
console.log(failures === 0 ? 'ALL LAYOUT CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

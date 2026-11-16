// Regression coverage for the three reported defects:
//  1. the "Move to category" submenu must actually open (it used to close the
//     popup first, so its own setMenu updater saw null and did nothing);
//  2. a long press must start a drag sooner than 320 ms;
//  3. a drag inside one box must re-order freely, with no marker on the dragged
//     row itself and a real seat at the end of the box.
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(process.argv[2], 'utf8')
let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures++
  console.log('FAIL ' + label + '\n  got      ' + JSON.stringify(actual) + '\n  expected ' + JSON.stringify(expected))
}
const ok = (label, condition) => check(label, Boolean(condition), true)

// ---------------------------------------------------------------- 2. timing
const press = source.match(/const LONG_PRESS_MS = (\d+)/)
ok('long press constant exists', press !== null)
const pressMs = Number(press[1])
ok('long press is under the old 320 ms (' + pressMs + ')', pressMs < 320)
ok('long press is not so short it fights a click (' + pressMs + ')', pressMs >= 120)

// ------------------------------------------------- 1. submenu activation path
// Extract the real activateMenuItem body and drive it against a fake state pair.
const activateStart = source.indexOf('const activateMenuItem = React.useCallback((item) => {')
const bodyOpen = source.indexOf('{', source.indexOf('=>', activateStart)) 
const bodyClose = source.indexOf('\n      }, [])', bodyOpen)
ok('activateMenuItem found', activateStart !== -1 && bodyOpen !== -1 && bodyClose !== -1)
const activateBody = source.slice(bodyOpen + 1, bodyClose)
// Re-point the closure's free names at locals so the body runs outside React.
// `item` is the callback parameter, so it becomes a parameter here too.
const runner = new Function('menuRef', 'setMenu', 'item', `
  const activateMenuItem = function (item) {
    ${activateBody}
  }
  return activateMenuItem
`)

// Case A: a plain row closes the popup and runs exactly once.
{
  const calls = []
  let menu = { point: { x: 10, y: 20 }, items: [{ id: 'a' }] }
  const setMenu = (next) => { menu = next }
  const rowA = { id: 'a', run: () => calls.push('a') }
  const activate = runner({ current: menu }, setMenu, rowA)
  activate(rowA)
  check('plain row runs once', calls, ['a'])
  check('plain row closes the popup', menu, null)
}

// Case B: the submenu row keeps the popup open and swaps its rows.
{
  const calls = []
  let menu = { point: { x: 10, y: 20 }, items: [{ id: 'move' }] }
  const seenPoints = []
  const setMenu = (next) => { menu = next }
  const rowMove = {
    id: 'move',
    keepOpen: true,
    replaceWith: (point) => { seenPoints.push(point); return [{ id: 'to-c1', label: 'A' }, { id: 'to-c2', label: 'B' }] },
    run: () => calls.push('move'),
  }
  const activate = runner({ current: menu }, setMenu, rowMove)
  activate(rowMove)
  ok('submenu does NOT close the popup', menu !== null)
  check('submenu swapped in its target rows', menu.items.map(item => item.id), ['to-c1', 'to-c2'])
  check('submenu keeps the original anchor', menu.point, { x: 10, y: 20 })
  check('submenu receives the anchor point', seenPoints, [{ x: 10, y: 20 }])
  check('submenu row itself does not run a move', calls, [])
}

// Case C: a target row inside the swapped submenu closes and performs the move.
{
  const calls = []
  let menu = { point: { x: 5, y: 6 }, items: [{ id: 'to-c2' }] }
  const setMenu = (next) => { menu = next }
  const rowTarget = { id: 'to-c2', run: () => calls.push('to-c2') }
  const activate = runner({ current: menu }, setMenu, rowTarget)
  activate(rowTarget)
  check('target row performs the move', calls, ['to-c2'])
  check('target row closes the popup', menu, null)
}

// The workspace menu really wires replaceWith onto the move row.
ok('move row declares replaceWith', /id: 'move',[\s\S]{0,260}replaceWith:/.test(source))
ok('move row is no longer a bare setMenu updater', !/id: 'move',[\s\S]{0,400}setMenu\(current =>/.test(source))
ok('PopupMenu receives onActivate', /h\(PopupMenu, \{ menu, onClose: closeMenu, onActivate: activateMenuItem \}\)/.test(source))
ok('menu row calls onActivate', /onActivate\(item\)/.test(source))

// ------------------------------------------------- 3. free re-ordering in a box
// Drive the real resolveDropHint against a fake DOM so seat resolution is tested,
// not merely assumed.
const resolveStart = source.indexOf('function resolveDropHint(active, x, y) {')
const resolveEnd = source.indexOf('\n      }', source.indexOf('return { categoryId, beforeId, append: after && beforeId === undefined }', resolveStart))
const resolveSrc = source.slice(resolveStart, resolveEnd + '\n      }'.length)

/** Build a fake DOM: one box holding rows at fixed viewport rectangles. */
function fakeDom({ boxId = 'c1', rows = [], boxRect = { top: 0, height: 200 } }) {
  const rowNodes = rows.map(row => ({
    id: row.id,
    rect: row.rect,
    getAttribute: (name) => (name === 'data-wsx-item' ? row.id : null),
    getBoundingClientRect: () => ({ ...row.rect, left: 0, right: 300, width: 300 }),
  }))
  const boxNode = {
    id: boxId,
    getAttribute: (name) => (name === 'data-wsx-cat' ? boxId : null),
    getBoundingClientRect: () => ({ ...boxRect, left: 0, right: 300, width: 300 }),
    contains: (node) => rowNodes.includes(node),
    querySelectorAll: (selector) => (selector === '[data-wsx-item]' ? rowNodes : []),
  }
  const hitFor = (x, y) => {
    for (const node of rowNodes) {
      const { top, height } = node.rect
      if (y >= top && y <= top + height) return node
    }
    return boxNode
  }
  return {
    elementFromPoint: (x, y) => {
      const node = hitFor(x, y)
      // Give the row/box a closest() that reports its own chain, like the real DOM.
      return {
        closest(selector) {
          if (selector === '[data-wsx-cat]') return boxNode
          if (selector === '[data-wsx-item]') return rowNodes.includes(node) ? node : null
          return null
        },
      }
    },
  }
}

function makeResolver(dom, doc, orderedCategories) {
  const fn = new Function('document', 'doc', 'orderedCategories', 'UNASSIGNED', 'OTHER_SESSIONS', `
    ${resolveSrc}
    return resolveDropHint
  `)
  return fn(dom, doc, orderedCategories, '__unassigned__', '__other__')
}

const rows = [
  { id: 'w1', rect: { top: 0, height: 30 } },
  { id: 'w2', rect: { top: 30, height: 30 } },
  { id: 'w3', rect: { top: 60, height: 30 } },
]
const doc = { categories: [{ id: 'c1', pinned: false, workspaceIds: ['w1', 'w2', 'w3'] }] }
const dom = fakeDom({ rows })
const resolve = makeResolver(dom, doc, doc.categories)

const drag = { kind: 'workspace', workspaceId: 'w1', categoryId: 'c1' }
check('upper half of w2 inserts before w2', resolve(drag, 100, 35), { categoryId: 'c1', beforeId: 'w2', append: false })
check('lower half of w2 inserts before w3', resolve(drag, 100, 55), { categoryId: 'c1', beforeId: 'w3', append: false })
check('lower half of last row is the append seat', resolve(drag, 100, 85), { categoryId: 'c1', beforeId: undefined, append: true })
check('empty box area below rows is the append seat', resolve(drag, 100, 150), { categoryId: 'c1', beforeId: undefined, append: true })

// Hovering the dragged row itself must not offer a seat.
check('hovering the dragged row offers no marker', resolve(drag, 100, 10), null)
check('hovering the dragged row lower half offers no marker', resolve(drag, 100, 25), null)

// A different row is still a valid target while dragging w1.
const dragW2 = { kind: 'workspace', workspaceId: 'w2', categoryId: 'c1' }
check('dragging w2 onto w1 upper half', resolve(dragW2, 100, 10), { categoryId: 'c1', beforeId: 'w1', append: false })
check('dragging w2 onto w3 lower half appends', resolve(dragW2, 100, 85), { categoryId: 'c1', beforeId: undefined, append: true })

// Category drags never resolve to the two virtual buckets.
{
  const catDom = fakeDom({ boxId: 'c1', rows: [] })
  const catResolve = makeResolver(catDom, doc, doc.categories)
  check('category dropped on its own box keeps a valid anchor id', catResolve({ kind: 'category', categoryId: 'c1' }, 100, 10).categoryId, 'c1')
  const pinnedDoc = { categories: [{ id: 'p', pinned: true, workspaceIds: [] }, { id: 'n', pinned: false, workspaceIds: [] }] }
  const pinDom = fakeDom({ boxId: 'p', rows: [] })
  const pinResolve = makeResolver(pinDom, pinnedDoc, pinnedDoc.categories)
  check('cross-group category drop refused', pinResolve({ kind: 'category', categoryId: 'n' }, 100, 10), null)
}

console.log(failures === 0 ? 'ALL REGRESSION CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

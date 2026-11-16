// Confirm the shipped helpers used by the UI are exercised end-to-end, and that
// the gesture that the review flagged as destructive (self-drop) is inert.
const fs = require('node:fs')
const vm = require('node:vm')
const source = fs.readFileSync(process.argv[2], 'utf8')

const helpers = source.slice(
  source.indexOf('function normalize'),
  source.indexOf('/* ------------------------------------------------------------------ */\n    /* Overlay host'),
)
const helperModule = { exports: {} }
const ctx = vm.createContext({ module: helperModule, console, COLORS: ['brand', 'blue', 'green', 'amber', 'violet', 'rose', 'slate'] })
vm.runInContext(helpers + '\nmodule.exports = { moved, inserted, assignWorkspace, withoutWorkspace, reorderCategory, mintCategoryId, normalize }', ctx)
const { moved, inserted, assignWorkspace, withoutWorkspace, reorderCategory, mintCategoryId, normalize } = helperModule.exports

let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures++
  console.log('FAIL ' + label + '\n  got      ' + JSON.stringify(actual) + '\n  expected ' + JSON.stringify(expected))
}

// inserted(): the semantics cross-category assignment relies on.
check('inserted appends when absent', inserted(['a'], 'z', undefined), ['a', 'z'])
check('inserted before anchor', inserted(['a', 'b'], 'z', 'b'), ['a', 'z', 'b'])
check('inserted keeps single membership', inserted(['a', 'z'], 'z', 'a'), ['z', 'a'])
check('inserted bogus anchor appends', inserted(['a'], 'z', 'nope'), ['a', 'z'])

// A category holding two workspaces: dropping w2 above w1 swaps them.
const cats = [
  { id: 'c1', pinned: false, workspaceIds: ['w1', 'w2', 'w3'] },
  { id: 'c2', pinned: false, workspaceIds: [] },
  { id: 'p', pinned: true, workspaceIds: [] },
]
check('reorder within category up', assignWorkspace(cats, 'w3', 'c1', 'w1').map(c => c.workspaceIds),
  [['w3', 'w1', 'w2'], [], []])
check('move into empty category', assignWorkspace(cats, 'w2', 'c2', undefined).map(c => c.workspaceIds),
  [['w1', 'w3'], ['w2'], []])
check('membership never duplicated', (() => {
  const out = assignWorkspace(cats, 'w1', 'c2', undefined)
  const all = out.flatMap(c => c.workspaceIds)
  return all.length === new Set(all).size
})(), true)

// Self-drop gestures from resolveDropHint must be inert (dropHint.beforeId === dragged id).
check('self-drop on own row is inert', assignWorkspace(cats, 'w2', 'c1', 'w2'), cats)
check('self-drop on own category head is inert', reorderCategory(cats, 'c1', 'c1'), cats)

// Pinned grouping: reordering unpinned must not cross the pinned boundary.
const grouped = [
  { id: 'p1', pinned: true, workspaceIds: [] },
  { id: 'n1', pinned: false, workspaceIds: [] },
  { id: 'n2', pinned: false, workspaceIds: [] },
  { id: 'p2', pinned: true, workspaceIds: [] },
]
check('unpinned reorder stays in unpinned slots', reorderCategory(grouped, 'n1', undefined).map(c => c.id),
  ['p1', 'n2', 'n1', 'p2'])
check('pinned reorder stays in pinned slots', reorderCategory(grouped, 'p1', undefined).map(c => c.id),
  ['p2', 'n1', 'n2', 'p1'])
check('cross-group reorder refused', reorderCategory(grouped, 'n1', 'p1'), grouped)

// mintCategoryId never collides.
check('mint avoids collision', mintCategoryId([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }]), 'c4')
check('mint starts fresh', mintCategoryId([]), 'c1')

// normalize survives hostile input without throwing.
check('normalize(null) is safe', normalize(null).categories, [])
check('normalize keeps ids unique-ish and shapes', (() => {
  const out = normalize({ categories: [{ id: 'a', name: 'A', color: 'blue', workspaceIds: ['w', 'w'] }] })
  return out.categories[0].workspaceIds
})(), ['w', 'w'])

// withoutWorkspace returns identical reference when nothing matches (no needless write).
check('unassign absent keeps reference', withoutWorkspace(cats, 'nope'), cats)

console.log(failures === 0 ? 'ALL GESTURE CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

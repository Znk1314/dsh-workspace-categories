// Verify the workspace fold works like the category fold: it is remembered per
// workspace, a query overrides it, and the document keeps it.
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(process.argv[2], 'utf8')
let failures = 0
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) === JSON.stringify(expected)) return
  failures++
  console.log('FAIL ' + label + '\n  got      ' + JSON.stringify(actual) + '\n  expected ' + JSON.stringify(expected))
}

const helpers = source.slice(
  source.indexOf('function normalize'),
  source.indexOf('/* ------------------------------------------------------------------ */\n    /* Overlay host'),
)
const helperModule = { exports: {} }
const ctx = vm.createContext({ module: helperModule, console, COLORS: ['brand', 'blue', 'green', 'amber', 'violet', 'rose', 'slate'] })
vm.runInContext(helpers + '\nmodule.exports = { normalize }', ctx)
const { normalize } = helperModule.exports

// A document without the field still normalises, so an older saved file loads.
check('missing fold list becomes empty', normalize({}).collapsedWorkspaces, [])
check('null fold list becomes empty', normalize({ collapsedWorkspaces: null }).collapsedWorkspaces, [])
check('fold list is de-duplicated', normalize({ collapsedWorkspaces: ['a', 'a', 'b'] }).collapsedWorkspaces, ['a', 'b'])
check('non-string entries dropped', normalize({ collapsedWorkspaces: ['a', 1, '', null, 'b'] }).collapsedWorkspaces, ['a', 'b'])
check('folds survive a normalise round-trip', normalize(normalize({ collapsedWorkspaces: ['w1'] })).collapsedWorkspaces, ['w1'])

// The fold toggle lives in the action table and flips membership.
const toggleSrc = source.slice(
  source.indexOf('toggleWorkspaceCollapsed: (workspaceId) => {'),
  source.indexOf('},', source.indexOf('toggleWorkspaceCollapsed: (workspaceId) => {')) + 2,
)
const toggle = new Function('update', `
  const actions = { ${toggleSrc} }
  return actions.toggleWorkspaceCollapsed
`)
{
  let captured = null
  const update = (mutate) => { captured = mutate({ collapsedWorkspaces: [] }) }
  toggle(update)('w1')
  check('folding adds the workspace', captured.collapsedWorkspaces, ['w1'])
}
{
  let captured = null
  const update = (mutate) => { captured = mutate({ collapsedWorkspaces: ['w1', 'w2'] }) }
  toggle(update)('w1')
  check('unfolding removes only that workspace', captured.collapsedWorkspaces, ['w2'])
}

// A query must re-open a folded workspace, mirroring the category behaviour.
check('fold respects the query override', /const folded = doc\.collapsedWorkspaces\.includes\(key\) && !searching/.test(source), true)
check('folded workspace hides its rows', /folded\s*\n\s*\? null\s*\n\s*: \[/.test(source), true)
// Both the header and the workspace menu offer the fold.
check('workspace header has a fold button', /className: 'wsx-workspace-fold'/.test(source), true)
check('workspace menu offers the fold', /id: 'fold',[\s\S]{0,220}toggleWorkspaceCollapsed/.test(source), true)
check('category fold still present', /className: 'wsx-cat-fold'/.test(source), true)

console.log(failures === 0 ? 'ALL FOLD CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

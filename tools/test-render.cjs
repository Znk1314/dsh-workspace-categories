// Render every tab with realistic data. A single undefined binding inside the
// component throws during render, which makes the slot entry abdicate and
// silently falls back to the shipped browser — the failure is invisible from the
// slot ledger alone, so it needs an explicit check.
const fs = require('node:fs')
const vm = require('node:vm')

const source = fs.readFileSync(process.argv[2], 'utf8')
let failures = 0
const ok = (label, condition, detail) => {
  if (condition) return
  failures++
  console.log('FAIL ' + label + (detail === undefined ? '' : '\n  ' + detail))
}

// --- capture the plugin factory --------------------------------------------
let captured = null
const React = {
  createElement: (type, props, ...kids) => ({ type, props, kids }),
  useState: value => [value, () => {}],
  useRef: () => ({ current: null }),
  useEffect: () => {},
  useMemo: fn => fn(),
  useCallback: fn => fn,
  useSyncExternalStore: (subscribe, get) => get(),
}
const noopEl = () => ({ setAttribute() {}, textContent: '', append() {} })
const sandbox = {
  window: {
    __ModuleLoader__: { load(definition) { captured = definition } },
    setInterval: () => 0,
    clearInterval: () => {},
    addEventListener() {},
    removeEventListener() {},
  },
  document: {
    createElement: noopEl,
    head: { append() {} },
    addEventListener() {},
    removeEventListener() {},
    querySelector: () => null,
  },
  require(name) {
    if (name === 'react') return React
    if (name === 'react-dom') return { createPortal: children => children }
    throw new Error('unexpected require: ' + name)
  },
  console,
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  setInterval: () => 0,
  clearInterval: () => {},
  setTimeout: () => 0,
  clearTimeout: () => {},
}
sandbox.globalThis = sandbox
vm.createContext(sandbox)
vm.runInContext(source, sandbox, { filename: 'client.js' })

ok('module registers itself', captured !== null)
if (captured === null) {
  console.log('1 CHECK(S) FAILED')
  process.exit(1)
}

const plugin = captured.factory(sandbox.require)
ok('factory returns a plugin with apply', typeof plugin.apply === 'function')

// --- run apply() against a stub context ------------------------------------
let entry = null
const ctx = {
  get: () => ({}),
  effect: (fn) => { fn(); return () => {} },
  slots: { inject: (key, callback) => callback(), register: (options, component) => { entry = { options, component } } },
  locale: { register: () => () => {} },
}
try {
  plugin.apply(ctx)
} catch (error) {
  failures++
  console.log('FAIL apply() threw: ' + error.message)
}
ok('apply registers the sidebar.workspaces entry', entry !== null)
if (entry === null) {
  console.log(failures + ' CHECK(S) FAILED')
  process.exit(1)
}
ok('the entry shadows the shipped browser', entry.options.priority < 0)

// --- render each tab with realistic state ----------------------------------
const face = entry.options.inject()
const workspaces = [
  { workspaceId: 'w1', path: 'D:\\a\\Alpha', title: 'Alpha', sessionIds: ['s1', 's2'], createdAt: '', updatedAt: '' },
  { workspaceId: 'w2', path: 'D:\\b\\Beta', title: 'Beta', sessionIds: ['s3', 's4'], createdAt: '', updatedAt: '' },
  { workspaceId: 'w3', path: 'D:\\c\\Gamma', title: 'Gamma', sessionIds: ['s5'], createdAt: '', updatedAt: '' },
]
const now = Date.now()
const summary = (id, minutesAgo, extra) => ({
  id,
  title: id + '-title',
  displayTitle: id + '-title',
  updatedAt: now - minutesAgo * 60000,
  retainedBy: {},
  blank: false,
  ...extra,
})
const sessions = {
  ids: ['s1', 's2', 's3', 's4', 's5'],
  byId: {
    s1: summary('s1', 1),
    s2: summary('s2', 2),
    s3: summary('s3', 3),
    s4: summary('s4', 4),
    s5: summary('s5', 5, { origin: 'subagent' }),
  },
  phase: 'ready',
}

const baseDoc = (tab) => ({
  version: 1,
  categories: [
    { id: 'c1', name: 'Work', color: 'blue', icon: 'briefcase', pinned: true, collapsed: false, workspaceIds: ['w1'] },
    { id: 'c2', name: 'Study', color: 'green', icon: 'graduation', pinned: false, collapsed: false, workspaceIds: ['w2'] },
  ],
  view: { tab, archived: 'default' },
  unassignedCollapsed: false,
  collapsedWorkspaces: [],
})

const propsFor = (tab, overrides = {}) => {
  face.docStore.replace(baseDoc(tab))
  return {
    wide: true,
    expandSidebar: () => {},
    t: key => key,
    actions: face.actions,
    docStore: face.docStore,
    saveStore: { subscribe: () => () => {}, get: () => null },
    useWorkspaces: selector => selector(overrides.workspaces ?? {
      items: workspaces, archivedSessionIds: [], pinnedSessionIds: [], phase: 'ready', state: 'idle',
    }),
    useSessions: selector => selector(sessions),
    useSessionStatus: selector => selector(new Map()),
    usePanelInfo: selector => selector({ activePanelId: null }),
    useContextMenu: () => ({ getTriggerProps: () => ({}) }),
    ...overrides.rest,
  }
}

/** Walk a rendered tree, counting the rows a tab produced. */
const count = (tree, predicate) => {
  let total = 0
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return
    if (Array.isArray(node)) { node.forEach(walk); return }
    const className = node.props === undefined ? undefined : node.props.className
    if (typeof className === 'string' && predicate(className)) total++
    if (Array.isArray(node.kids)) node.kids.forEach(walk)
  }
  walk(tree)
  return total
}

const tabs = ['categories', 'recent', 'all']
for (const tab of tabs) {
  let tree = null
  try {
    tree = entry.component(propsFor(tab))
  } catch (error) {
    failures++
    console.log('FAIL tab "' + tab + '" threw during render: ' + error.message)
    console.log('  ' + String(error.stack).split('\n')[1])
    continue
  }
  ok('tab "' + tab + '" renders an element', tree !== null && tree !== undefined)

  const bars = count(tree, className => className.includes('wsx-bar'))
  const rows = count(tree, className => className.split(' ').includes('wsx-session'))
  const guides = count(tree, className => className.split(' ').includes('wsx-guide'))
  const chips = count(tree, className => className.split(' ').includes('wsx-chip'))

  if (tab === 'categories') {
    /* Two user categories plus the demoted Unassigned footer bar. */
    ok('categories tab draws both category bars plus the footer (' + bars + ')', bars === 3)
    ok('categories tab draws session rows', rows > 0)
    ok('categories tab draws an indent guide per workspace', guides >= 2)
    ok('no status dots are rendered', count(tree, c => c.includes('wsx-dot')) === 0)
  }
  if (tab === 'recent') {
    /* Recent lists workspaces directly, without category bars. */
    ok('recent tab draws no category bars (' + bars + ')', bars === 0)
    ok('recent tab still shows session rows', rows > 0)
  }
  if (tab === 'all') {
    ok('all tab draws one flat list', rows > 0)
  }
  /* The recent chip strip was removed on request; the Recent TAB remains. */
  ok('no chip strip is rendered', chips === 0)
  console.log(tab + ': bars=' + bars + ' rows=' + rows + ' guides=' + guides + ' chips=' + chips)
}

// --- the states that must not crash ---------------------------------------
const emptyProps = propsFor('categories', {
  workspaces: { items: [], archivedSessionIds: [], pinnedSessionIds: [], phase: 'ready', state: 'idle' },
})
try {
  entry.component(emptyProps)
} catch (error) {
  failures++
  console.log('FAIL empty sidebar threw: ' + error.message)
}

const errorProps = propsFor('categories', {
  workspaces: { items: [], archivedSessionIds: [], pinnedSessionIds: [], phase: 'pending', state: 'error', error: { message: 'boom' } },
})
try {
  entry.component(errorProps)
} catch (error) {
  failures++
  console.log('FAIL error state threw: ' + error.message)
}

// Narrow/rail layout is a separate early return; it must render too.
const railProps = { ...propsFor('categories'), wide: false }
try {
  const tree = entry.component(railProps)
  ok('rail layout renders', tree !== null)
} catch (error) {
  failures++
  console.log('FAIL rail layout threw: ' + error.message)
}

console.log(failures === 0 ? 'ALL RENDER CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

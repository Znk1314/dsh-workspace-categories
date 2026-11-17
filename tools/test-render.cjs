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
/* Faithful enough to model what the component relies on: children must land on
   props.children (a boundary reads them there), and Component must exist so the
   module-level class expression is not what fails. */
class StubComponent {
  constructor(props) {
    this.props = props
    this.state = {}
  }
}
const React = {
  Component: StubComponent,
  createElement: (type, props, ...kids) => {
    const merged = { ...(props || {}) }
    if (kids.length === 1) merged.children = kids[0]
    else if (kids.length > 1) merged.children = kids
    return { type, props: merged, kids }
  },
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
/* The live slot ledger reports this exact value back, which proves the
   registration path applies it rather than overwriting it. Dropping it once lost
   the election and the built-in browser took the sidebar. */
ok('the entry wins the slot with a negative priority', entry.options.priority < 0)
ok('the entry seats into the browsing region', entry.options.name === 'sidebar.workspaces')

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
    /* s1 is running via the summary flag alone: the status map has no baseline
       entry for it, which is the case that broke the spinner in practice. */
    s1: summary('s1', 1, { running: true }),
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
    useSessionStatus: selector => selector(overrides.statuses ?? new Map()),
    usePanelInfo: selector => selector({ activePanelId: null }),
    useContextMenu: () => ({ getTriggerProps: () => ({}) }),
    /* A spy: this package replaced the shipped browser, so whether it still
       offers the child seats is exactly what needs proving. */
    renderSlot: (key, slotProps) => {
      if (overrides.renderSlot !== undefined) return overrides.renderSlot(key, slotProps)
      slotCalls.push({ key, slotProps })
      return null
    },
    ...overrides.rest,
  }
}

/** Recorded child-slot seats; reset before each tab. */
const slotCalls = []

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
  const spinners = count(tree, className => className.split(' ').includes('wsx-spinner'))
  const times = count(tree, className => className.split(' ').includes('wsx-session-time'))

  if (tab === 'categories') {
    /* Two user categories plus the demoted Unassigned footer bar. */
    ok('categories tab draws both category bars plus the footer (' + bars + ')', bars === 3)
    ok('categories tab draws session rows', rows > 0)
    ok('categories tab draws an indent guide per workspace', guides >= 2)
    ok('no status dots are rendered', count(tree, c => c.includes('wsx-dot')) === 0)
    /* The category row offers a one-gesture "new workspace here" button. */
    ok('the category row has an add button',
      count(tree, c => c.split(' ').includes('wsx-cat-add')) === 2)
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
  /* s1 runs via its summary flag with no status-map entry: the spinner must
     appear, and it must REPLACE that row's timestamp rather than join it. */
  ok('a running session shows a spinner (' + spinners + ')', spinners === 1)
  ok('no awaiting dot while nothing waits', count(tree, c => c.split(' ').includes('wsx-await-dot')) === 0)
  ok('the running row drops its timestamp', times === rows - 1)
  console.log(tab + ': bars=' + bars + ' rows=' + rows + ' guides=' + guides
    + ' chips=' + chips + ' spinners=' + spinners + ' times=' + times)
}

// --- the child seats the shipped browser offered ---------------------------
/* Replacing the browsing region silently evicts every extension that seats
   itself inside a session row. These seats must keep being offered. */
slotCalls.length = 0
entry.component(propsFor('categories'))
const seatedKeys = new Set(slotCalls.map(call => call.key))
const SEATS = [
  'sidebar.session.row.leading',
  'sidebar.session.row.trailing',
  'sidebar.workspaces.session.row.action',
]
for (const seat of SEATS) {
  ok('the row offers the ' + seat + ' seat', seatedKeys.has(seat))
}
/* Every call must carry the session it belongs to, or an extension cannot tell
   its rows apart. */
const missingId = slotCalls.filter(call => typeof call.slotProps?.sessionId !== 'string')
ok('every seat call names its session', missingId.length === 0)
/* The row action seat also carries the display title, as the shipped one does. */
const actionCalls = slotCalls.filter(call => call.key === 'sidebar.workspaces.session.row.action')
ok('the action seat carries a display title',
  actionCalls.every(call => typeof call.slotProps?.displayTitle === 'string'))

/* A seat that throws, or that this build does not declare, must not take the
   sidebar down. */
try {
  const tree = entry.component(propsFor('categories', {
    renderSlot: () => { throw new Error('undeclared seat') },
  }))
  ok('a throwing seat does not break the row', tree !== null)
} catch (error) {
  failures++
  console.log('FAIL a throwing seat broke the render: ' + error.message)
}

/* With nothing seated, the row must not gain empty flex cells. */
slotCalls.length = 0
const bareTree = entry.component(propsFor('categories'))
ok('empty seats render no wrapper',
  count(bareTree, c => c.split(' ').includes('wsx-session-leading')) === 0)

/* A seated extension must be wrapped in a containment boundary: its failure
   happens during React's render, where a try/catch around renderSlot cannot
   reach it, and a throw there hands the sidebar back to the built-in browser. */
const seatedTree = entry.component(propsFor('categories', {
  renderSlot: () => ({ type: 'span', props: { className: 'ext-entry' }, kids: [] }),
}))
let boundaryCount = 0
const findBoundary = (node) => {
  if (node === null || typeof node !== 'object') return
  if (Array.isArray(node)) { node.forEach(findBoundary); return }
  if (typeof node.type === 'function') boundaryCount++
  if (Array.isArray(node.kids)) node.kids.forEach(findBoundary)
}
findBoundary(seatedTree)
ok('a seated extension is wrapped in a boundary (' + boundaryCount + ')', boundaryCount > 0)
ok('the seated content still renders',
  count(seatedTree, c => c.split(' ').includes('ext-entry')) > 0)

// --- a turn that stopped to ask the user -----------------------------------
/* The reported behaviour: a session waiting on a choice must show the orange dot
   in the trailing cell, not a left-hand "waiting" label, and the dot must beat
   the running spinner because nothing is running while the user is deciding. */
const awaitingTree = entry.component(propsFor('categories', {
  statuses: new Map([
    ['s2', { running: true, pendingInteraction: { kind: 'question' }, completionUnread: false }],
  ]),
}))
ok('an awaiting session shows the orange dot',
  count(awaitingTree, c => c.split(' ').includes('wsx-await-dot')) === 1)
ok('no left-hand flag is rendered', !/wsx-session-flag/.test(source))
/* s1 still runs, so exactly one spinner survives; s2's spinner yielded to the dot. */
ok('the awaiting row yields its spinner',
  count(awaitingTree, c => c.split(' ').includes('wsx-spinner')) === 1)
ok('the awaiting row drops its timestamp',
  count(awaitingTree, c => c.split(' ').includes('wsx-session-time')) ===
    count(awaitingTree, c => c.split(' ').includes('wsx-session')) - 2)

// --- the states that must not crash ---------------------------------------
/* A dynamic browser half may receive no slot renderer at all. The row must still
   render, minus the seats. */
try {
  const tree = entry.component(propsFor('categories', { rest: { renderSlot: undefined } }))
  ok('a missing renderSlot does not break the row', tree !== null)
} catch (error) {
  failures++
  console.log('FAIL a missing renderSlot broke the render: ' + error.message)
}

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

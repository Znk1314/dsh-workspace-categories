// Exercise the Host half of the bundle against a stubbed Cordis context:
// register the route, then drive GET/PUT through its exact Fetch handler and
// prove the document round-trips through the real filesystem.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'

const home = await mkdtemp(join(tmpdir(), 'wsx-host-'))
let failures = 0
const check = (label, actual, expected) => {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.log('FAIL ' + label + '\n  got      ' + a + '\n  expected ' + e)
  }
}

/** Minimal Cordis context surface the Host half touches. */
const effects = []
const routes = []
const ctx = {
  get(name) {
    if (name === 'profileContext') return { dir: join(home, 'profile'), home }
    if (name === 'connection') return { fetch: { register: (route) => { routes.push(route); return () => Promise.resolve() } } }
    return undefined
  },
  inject(names, callback) {
    const services = {}
    for (const name of names) services[name] = ctx.get(name)
    const owner = {
      get: (name) => services[name],
      effect: (fn) => { effects.push(fn); return () => {} },
    }
    callback(owner)
  },
  effect(fn) { effects.push(fn); return () => {} },
}

apply(ctx)

check('registered exactly one route', routes.length, 1)
const route = routes[0]
check('route path', route.path, '/api/workspace-categories.doc')
check('route methods', route.methods, ['GET', 'PUT'])
check('route body mode', route.requestBody, 'buffered')

// A first GET must answer the empty document rather than fail.
const empty = await route.fetch(new Request('http://localhost/api/workspace-categories.doc'))
check('first GET status', empty.status, 200)
const emptyDoc = await empty.json()
check('first GET shape', Object.keys(emptyDoc).sort(), ['categories', 'unassignedCollapsed', 'version', 'view'])

// A PUT stores the document, and a later GET reads it back.
const payload = {
  version: 1,
  categories: [
    { id: 'c1', name: 'Client work', color: 'blue', pinned: true, collapsed: false, workspaceIds: ['w2', 'w1'] },
    { id: 'c2', name: 'Side projects', color: 'rose', pinned: false, collapsed: true, workspaceIds: ['w3'] },
  ],
  view: { mode: 'categories', archived: 'show' },
  unassignedCollapsed: true,
}
const put = await route.fetch(new Request('http://localhost/api/workspace-categories.doc', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(payload),
}))
check('PUT status', put.status, 200)
const stored = await put.json()
check('PUT echoes categories', stored.categories.map(c => [c.id, c.name, c.color, c.pinned, c.collapsed, c.workspaceIds]),
  [['c1', 'Client work', 'blue', true, false, ['w2', 'w1']], ['c2', 'Side projects', 'rose', false, true, ['w3']]])
check('PUT keeps view', stored.view, { mode: 'categories', archived: 'show' })

const reread = await (await route.fetch(new Request('http://localhost/api/workspace-categories.doc'))).json()
check('GET after PUT round-trips', reread.categories[0].workspaceIds, ['w2', 'w1'])

// The bytes on disk are the durable record, not just the in-memory cache.
const onDisk = JSON.parse(await readFile(join(home, 'plugin-data', 'dsh-workspace-categories', 'categories.json'), 'utf8'))
check('file on disk matches', onDisk.categories.map(c => c.id), ['c1', 'c2'])

// Hostile and partial payloads are repaired rather than persisted or thrown.
const hostile = await route.fetch(new Request('http://localhost/api/workspace-categories.doc', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    categories: [
      { id: 'dup', name: 'A', color: 'nope', workspaceIds: ['w1', 'w1', 5, ''] },
      { id: 'dup', name: 'B', workspaceIds: [] },
      null,
      'string',
    ],
    view: { mode: 'nonsense', archived: 'nonsense' },
  }),
}))
check('hostile PUT status', hostile.status, 200)
const repaired = await hostile.json()
check('duplicate ids collapsed', repaired.categories.map(c => c.id), ['dup'])
check('unknown colour normalised', repaired.categories[0].color, 'brand')
check('member list cleaned', repaired.categories[0].workspaceIds, ['w1'])
check('unknown enums normalised', repaired.view, { mode: 'categories', archived: 'default' })

// A malformed body must surface as a 500, not a silent success.
const broken = await route.fetch(new Request('http://localhost/api/workspace-categories.doc', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: '{not json',
}))
check('malformed body rejected', broken.status, 500)

// Concurrent writes serialise instead of interleaving.
const burst = Array.from({ length: 8 }, (_, index) => route.fetch(new Request('http://localhost/api/workspace-categories.doc', {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ categories: [{ id: `burst${index}`, name: `N${index}`, color: 'green', workspaceIds: [] }] }),
})))
const settled = await Promise.all(burst)
check('concurrent writes all succeed', settled.every(response => response.status === 200), true)
const finalDoc = JSON.parse(await readFile(join(home, 'plugin-data', 'dsh-workspace-categories', 'categories.json'), 'utf8'))
check('final file is valid JSON with one category', finalDoc.categories.length, 1)

await rm(home, { recursive: true, force: true })
console.log(failures === 0 ? 'ALL HOST CHECKS PASSED' : failures + ' CHECK(S) FAILED')
process.exitCode = failures === 0 ? 0 : 1

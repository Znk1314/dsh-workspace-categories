/**
 * Host half of the sidebar workspace skin bundle.
 *
 * The plugin's state is a small JSON document: the user's workspace categories
 * (name, colour, pinned flag, member workspace ids) plus the list view
 * preferences. The browser half owns the document; this half owns one
 * authenticated route that reads and replaces it durably, so the categories
 * survive page reloads and Host restarts instead of living in `localStorage`
 * on a port that changes between launches.
 *
 * The route registers inside Connection's authentication fence (only the owner
 * Peer reaches it). A profile without a Web carrier keeps the plugin otherwise
 * functional and simply reports a failed save.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Route the browser half calls; must stay a valid `/api` endpoint path. */
const DOC_ROUTE = '/api/workspace-categories.doc'

/** Category accents the browser half can render; anything else falls back. */
const COLORS = new Set(['brand', 'blue', 'green', 'amber', 'violet', 'rose', 'slate'])

/** Empty document a first launch starts from. */
const EMPTY_DOC = {
  version: 1,
  categories: [],
  view: { mode: 'categories', archived: 'default' },
  unassignedCollapsed: false,
}

/**
 * Resolve the harness data root for this profile.
 * @param ctx - Host plugin context, consulted for the launcher's profile facts.
 * @returns absolute directory that holds per-profile plugin data.
 */
function dataRoot(ctx) {
  const home = ctx.get('profileContext')?.home
  if (typeof home === 'string' && home !== '') return home
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return join(homedir(), '.dsh')
}

/**
 * Normalize one stored document, discarding anything the browser half cannot
 * render. A malformed file must not take the sidebar down: the user gets the
 * default empty document instead and the next save repairs it.
 * @param value - parsed JSON of unknown shape.
 * @returns a complete document with every field present.
 */
function normalizeDoc(value) {
  const doc = value !== null && typeof value === 'object' ? value : {}
  const view = doc.view !== null && typeof doc.view === 'object' ? doc.view : {}
  const categories = Array.isArray(doc.categories) ? doc.categories : []
  const seen = new Set()
  const cleanCategories = []
  for (const entry of categories) {
    if (entry === null || typeof entry !== 'object') continue
    const id = typeof entry.id === 'string' && entry.id !== '' ? entry.id : undefined
    if (id === undefined || seen.has(id)) continue
    seen.add(id)
    const workspaceIds = Array.isArray(entry.workspaceIds) ? entry.workspaceIds : []
    cleanCategories.push({
      id,
      name: typeof entry.name === 'string' && entry.name.trim() !== '' ? entry.name : 'Category',
      color: COLORS.has(entry.color) ? entry.color : 'brand',
      pinned: entry.pinned === true,
      collapsed: entry.collapsed === true,
      workspaceIds: workspaceIds
        .filter(workspaceId => typeof workspaceId === 'string' && workspaceId !== '')
        .filter((workspaceId, index, all) => all.indexOf(workspaceId) === index),
    })
  }
  return {
    version: 1,
    categories: cleanCategories,
    view: {
      mode: view.mode === 'flat' ? 'flat' : 'categories',
      archived: view.archived === 'show' || view.archived === 'only' ? view.archived : 'default',
    },
    unassignedCollapsed: doc.unassignedCollapsed === true,
  }
}

/**
 * Answer one JSON response.
 * @param status - HTTP status code.
 * @param body - JSON-serializable body.
 * @returns the response.
 */
function json(status, body) {
  return Response.json(body, { status, headers: { 'cache-control': 'no-store' } })
}

/**
 * Apply the plugin: one route, one durable file, serialized writes.
 * @param ctx - Host plugin context.
 */
export function apply(ctx) {
  const root = join(dataRoot(ctx), 'plugin-data', 'dsh-workspace-categories')
  const docPath = join(root, 'categories.json')
  /** One write at a time keeps a burst of drag commits from interleaving. */
  let queue = Promise.resolve()
  let cache

  /**
   * Read the document once per activation, then serve the cached copy.
   * @returns the normalized document.
   */
  const load = async () => {
    if (cache !== undefined) return cache
    try {
      cache = normalizeDoc(JSON.parse(await readFile(docPath, 'utf8')))
    } catch {
      cache = normalizeDoc(EMPTY_DOC)
    }
    return cache
  }

  /**
   * Replace the document durably before acknowledging the write.
   * @param raw - parsed request body.
   * @returns the stored document.
   */
  const save = (raw) => {
    const next = normalizeDoc(raw)
    cache = next
    const task = queue.then(async () => {
      await mkdir(dirname(docPath), { recursive: true })
      const temporary = `${docPath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await rename(temporary, docPath)
    })
    queue = task.catch(() => {})
    return task.then(() => next)
  }

  const register = (connection) => {
    const route = {
      path: DOC_ROUTE,
      methods: ['GET', 'PUT'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          if (request.method === 'GET') return json(200, await load())
          if (request.method !== 'PUT') return json(405, { error: 'method not allowed' })
          const stored = await save(await request.json())
          return json(200, stored)
        } catch (error) {
          return json(500, { error: error instanceof Error ? error.message : String(error) })
        }
      },
    }
    return connection.fetch.register(route)
  }

  ctx.inject(['connection'], (owner) => {
    const connection = owner.get('connection')
    if (connection === undefined) return
    const dispose = register(connection)
    owner.effect(() => () => { void dispose?.() })
  })
}

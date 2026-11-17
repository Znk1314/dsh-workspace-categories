/**
 * Browser half of the sidebar workspace skin bundle.
 *
 * Replaces the sidebar's workspace browsing region with a categorised view:
 * every category is one rounded box holding an ordered set of workspaces, and
 * a long press on a workspace header starts a drag that moves that workspace
 * into another category (or re-orders it inside its own). Categories can be
 * renamed, coloured, pinned, folded, deleted, and re-ordered. Workspaces
 * belonging to no category stay in an "Unassigned" box so nothing disappears,
 * and sessions that belong to no workspace stay in an "Other sessions" box for
 * the same reason.
 *
 * `sidebar.workspaces` is a `single` slot, so this entry shadows the shipped
 * browser by registering at a negative priority (SlotCore keeps the lowest
 * priority and sorts ascending). Session rows still raise the shipped Session
 * menu through the shared `useContextMenu` seat, and the shipped rename and
 * archive dialogs keep working because they live in `shell.overlay`.
 *
 * Two structural rules shape this file:
 *  - The sidebar establishes a containment context (its scroll region declares
 *    `container-type`), which makes `position: fixed` resolve against the
 *    sidebar rather than the viewport. Every overlay therefore renders through
 *    a portal into `document.body`.
 *  - Every drag-only operation has a menu path, so pointer, keyboard and touch
 *    users can all file and reorder things.
 */
window.__ModuleLoader__.load({
  id: 'dsh-workspace-categories',
  factory(require) {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement

    /**
     * Contains one seated extension's render failure.
     *
     * `renderSlot` runs during our render, so a try/catch around the call covers
     * only the call itself. The seated component actually renders later, inside
     * React's reconciliation, and a throw there propagates straight up through
     * this component — which makes the whole slot entry abdicate and hands the
     * sidebar back to the built-in browser. A boundary is the only construct that
     * stops that.
     *
     * Built behind a guard on purpose: a class expression evaluated at module
     * scope throws if the seeded React lacks `Component`, and a throw there takes
     * the entire plugin down before it can render anything. Without the boundary
     * the seats are simply rendered unwrapped.
     */
    const SeatBoundary = typeof React.Component === 'function'
      ? class SeatBoundary extends React.Component {
        constructor(props) {
          super(props)
          this.state = { failed: false }
        }

        static getDerivedStateFromError() {
          return { failed: true }
        }

        render() {
          /* Nothing to say: an extension's failure is not this package's to
             report, and the row simply renders without that seat. */
          return this.state.failed ? null : this.props.children
        }
      }
      : null

    /** Locale namespace owned by this plugin. */
    const NS = 'workspaceSkin'
    /** Host route serving the category document (see index.js). */
    const DOC_ROUTE = '/api/workspace-categories.doc'
    /**
     * Child slots the shipped browser renders inside its session rows. Declaring
     * them here means an extension that targets one keeps working, instead of
     * silently losing its seat because this package replaced the browser.
     */
    const CHILD_SLOTS = Object.freeze({
      leading: 'sidebar.session.row.leading',
      trailing: 'sidebar.session.row.trailing',
      action: 'sidebar.workspaces.session.row.action',
    })
    /**
     * Lower than the shipped browser's implicit 0, so this entry wins the slot.
     * Keep it: the live slot ledger reports this exact value back, so it is
     * applied on this registration path rather than overwritten.
     */
    const SHADOW_PRIORITY = -1000
    /** How long a press holds before a drag starts. */
    const LONG_PRESS_MS = 180
    /** Movement that cancels the pending long press (a scroll or a click). */
    const LONG_PRESS_SLOP_PX = 6
    /** Workspaces rendered per box before "Show more". */
    const BOX_LIMIT = 6
    /** Workspaces listed in the Recent tab. */
    const RECENT_LIMIT = 8
    /** Debounce for writing the document to the Host. */
    const SAVE_DEBOUNCE_MS = 240
    /** Virtual category ids for the two buckets that have no stored category. */
    const UNASSIGNED = '__unassigned__'
    const OTHER_SESSIONS = '__other__'

    /** Accent swatches a category may carry; the name is also its CSS class suffix. */
    const COLORS = ['ink', 'red', 'orange', 'amber', 'green', 'blue', 'violet', 'pink', 'slate']

    /**
     * Selectable category glyphs, in the order the picker shows them. Each entry
     * is one or more SVG paths drawn on the shared 16-unit grid.
     */
    const GLYPHS = {
      folder: ['M2 5.6A1.6 1.6 0 0 1 3.6 4h2.1l1.2 1.5h5.5A1.6 1.6 0 0 1 14 7.1v4.3A1.6 1.6 0 0 1 12.4 13H3.6A1.6 1.6 0 0 1 2 11.4z'],
      dollar: ['M8 2.4v11.2', 'M11 5.2a2.6 2.6 0 0 0-2.6-1.3C6.6 3.9 5.6 4.7 5.6 5.9c0 1.4 1.1 1.9 2.6 2.2 1.7.4 2.8.9 2.8 2.3 0 1.3-1.1 2.1-2.9 2.1A2.9 2.9 0 0 1 5.2 11.2'],
      book: ['M3.2 3.4h6.1A2.3 2.3 0 0 1 11.6 5.7v7.9A2.3 2.3 0 0 0 9.3 11.3H3.2z', 'M12.8 3.4H9.3'],
      graduation: ['M2.2 6.4 8 3.6l5.8 2.8L8 9.2z', 'M4.6 7.6v3.1c0 1 1.5 1.8 3.4 1.8s3.4-.8 3.4-1.8V7.6', 'M13.8 6.6v3.2'],
      pencil: ['M10.9 2.6 13.4 5.1 5.6 12.9 2.5 13.5l.6-3.1z', 'M9.8 3.7l2.5 2.5'],
      pen: ['M3.2 12.8c.4-2.2 1.6-4 3.4-5.6L11.4 3.3a1.7 1.7 0 0 1 2.4 2.4L9.9 10.5c-1.6 1.8-3.4 3-5.6 3.4z', 'M3.2 12.8l3.4-1'],
      braces: ['M6.2 2.8c-1.6 0-2 .9-2 2.2v1.4c0 1-.6 1.6-1.4 1.6.8 0 1.4.6 1.4 1.6V11c0 1.3.4 2.2 2 2.2', 'M9.8 2.8c1.6 0 2 .9 2 2.2v1.4c0 1 .6 1.6 1.4 1.6-.8 0-1.4.6-1.4 1.6V11c0 1.3-.4 2.2-2 2.2'],
      terminal: ['M2.4 3.4h11.2a1.2 1.2 0 0 1 1.2 1.2v6.8a1.2 1.2 0 0 1-1.2 1.2H2.4a1.2 1.2 0 0 1-1.2-1.2V4.6a1.2 1.2 0 0 1 1.2-1.2z', 'M4.2 6.6 5.9 8.4 4.2 10.2', 'M7.4 10.4h3'],
      music: ['M6.2 12.2V4.4l6-1.3v7.6', 'M3.3 12.9a2.1 1.7 0 1 0 4.2 0 2.1 1.7 0 1 0-4.2 0z', 'M9.3 11.6a2.1 1.7 0 1 0 4.2 0 2.1 1.7 0 1 0-4.2 0z'],
      cake: ['M2.4 7.4h11.2v4.4a1.6 1.6 0 0 1-1.6 1.6H4a1.6 1.6 0 0 1-1.6-1.6z', 'M2.4 10.4c1.4 0 1.4 1.1 2.8 1.1s1.4-1.1 2.8-1.1 1.4 1.1 2.8 1.1 1.4-1.1 2.8-1.1', 'M5.4 7.4V5.8M8 7.4V5.8M10.6 7.4V5.8', 'M5.4 4.4v.6M8 4.4v.6M10.6 4.4v.6'],
      scissors: ['M4.6 2.6 11.4 11.6', 'M11.4 2.6 4.6 11.6', 'M3.1 12.4a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0z', 'M9.1 12.4a1.9 1.9 0 1 0 3.8 0 1.9 1.9 0 1 0-3.8 0z'],
      palette: ['M8 2.4a5.6 5.6 0 0 0 0 11.2c1 0 1.4-.7 1.4-1.4 0-.9.6-1.4 1.4-1.4h1.6a1.8 1.8 0 0 0 1.8-1.8A5.6 5.6 0 0 0 8 2.4z', 'M5.5 6.2h.01M8 4.9h.01M10.5 6.2h.01M4.9 8.6h.01'],
      stethoscope: ['M4.4 2.4v4.2a3.2 3.2 0 0 0 6.4 0V2.4', 'M4.4 2.4h-1.2M10.8 2.4H12', 'M7.6 9.8v1.3a3 3 0 0 0 6 0v-.9'],
      gear: ['M6.9 2.4h2.2l.3 1.5 1.4.8 1.4-.6 1.1 1.9-1.1 1 .1 1.6 1.2.9-.9 2-1.5-.4-1.3.9-.2 1.5H7.4l-.3-1.5-1.3-.8-1.4.5-1-1.9 1.1-1v-1.6l-1.2-.9.9-2 1.5.4 1.4-.8z', 'M8 9.7a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4z'],
      lotus: ['M8 3.2c1.3 1.1 2 2.3 2 3.6 0 .8-.4 1.5-1 2', 'M8 3.2c-1.3 1.1-2 2.3-2 3.6 0 .8.4 1.5 1 2', 'M2.8 7.4c1.7-.4 3 .1 4 1.2', 'M13.2 7.4c-1.7-.4-3 .1-4 1.2', 'M8 8.6c1.9 0 3.4 1.6 3.4 3.6H4.6c0-2 1.5-3.6 3.4-3.6z'],
      briefcase: ['M2.4 6h11.2v5.4a1.4 1.4 0 0 1-1.4 1.4H3.8a1.4 1.4 0 0 1-1.4-1.4z', 'M6 6V4.6a1.2 1.2 0 0 1 1.2-1.2h1.6A1.2 1.2 0 0 1 10 4.6V6'],
      chart: ['M3.4 13V8.2', 'M8 13V3.6', 'M12.6 13V6.4', 'M2.4 13h11.2'],
      hourglass: ['M3.6 2.6h8.8', 'M3.6 13.4h8.8', 'M4.4 2.6v1.6c0 1.6 1.6 2.6 3.6 3.8-2 1.2-3.6 2.2-3.6 3.8v1.6', 'M11.6 2.6v1.6c0 1.6-1.6 2.6-3.6 3.8 2 1.2 3.6 2.2 3.6 3.8v1.6'],
      dumbbell: ['M2.4 6.4v3.2M4.6 4.8v6.4M11.4 4.8v6.4M13.6 6.4v3.2', 'M4.6 8h6.8'],
      list: ['M5.6 4.4h8', 'M5.6 8h8', 'M5.6 11.6h8', 'M2.8 4.4h.01M2.8 8h.01M2.8 11.6h.01'],
      scales: ['M8 2.6v10.8', 'M4 13.4h8', 'M2.4 6.2 8 4.4l5.6 1.8', 'M2.4 6.2 1 9.4h2.8z', 'M13.6 6.2 12.2 9.4h2.8z'],
      search: ['M7.2 12.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4z', 'M11 11l3 3'],
      plane: ['M2.4 8.2 13.6 2.6l-2.4 10.8-3.2-3.6z', 'M8 9.8 6.4 13'],
      globe: ['M8 13.6a5.6 5.6 0 1 0 0-11.2 5.6 5.6 0 0 0 0 11.2z', 'M2.6 8h10.8', 'M8 2.4c1.6 1.6 2.4 3.5 2.4 5.6S9.6 12 8 13.6c-1.6-1.6-2.4-3.5-2.4-5.6S6.4 4 8 2.4z'],
      wrench: ['M10.6 2.6a3.2 3.2 0 0 0-3 4.4l-4.2 4.2a1.4 1.4 0 0 0 2 2l4.2-4.2a3.2 3.2 0 0 0 4.4-3l-1.8 1.8-1.8-1.8z'],
      paw: ['M4.6 8.4c-1 0-1.6-1-1.6-2.2S3.6 4 4.6 4s1.6 1 1.6 2.2S5.6 8.4 4.6 8.4z', 'M11.4 8.4c-1 0-1.6-1-1.6-2.2S10.4 4 11.4 4s1.6 1 1.6 2.2-1 2.2-1.6 2.2z', 'M7.2 6.6c-.9 0-1.5-.9-1.5-2S6.3 2.6 7.2 2.6s1.5.9 1.5 2-.6 2-1.5 2z', 'M8 8.4c1.9 0 3.4 1.3 3.4 2.9 0 1.2-.9 1.9-2 1.9-.7 0-1-.3-1.4-.3s-.7.3-1.4.3c-1.1 0-2-.7-2-1.9C4.6 9.7 6.1 8.4 8 8.4z'],
      flask: ['M6.2 2.6h3.6', 'M6.8 2.6v3.6L3.4 12a1.3 1.3 0 0 0 1.1 2h7a1.3 1.3 0 0 0 1.1-2L9.2 6.2V2.6', 'M4.8 9.6h6.4'],
      brain: ['M6.4 2.6A2.4 2.4 0 0 0 4 5a2.2 2.2 0 0 0-.6 4 2.2 2.2 0 0 0 1.6 3.6 2 2 0 0 0 3.8-.6V4a1.4 1.4 0 0 0-2.4-1.4z', 'M9.6 2.6A2.4 2.4 0 0 1 12 5a2.2 2.2 0 0 1 .6 4 2.2 2.2 0 0 1-1.6 3.6 2 2 0 0 1-3.8-.6V4a1.4 1.4 0 0 1 2.4-1.4z'],
      heart: ['M8 13.2S2.6 10 2.6 6.4A3 3 0 0 1 8 4.6a3 3 0 0 1 5.4 1.8c0 3.6-5.4 6.8-5.4 6.8z'],
      plant: ['M8 13.4V7.2', 'M8 7.2c0-2 1.4-3.6 3.4-3.6 0 2-1.4 3.6-3.4 3.6z', 'M8 9c0-2-1.4-3.6-3.4-3.6 0 2 1.4 3.6 3.4 3.6z', 'M5.4 13.4h5.2'],
    }

    /** Glyph ids in picker order. */
    const GLYPH_IDS = Object.keys(GLYPHS)

    /** Icon a category carries when the stored value is unknown. */
    const DEFAULT_GLYPH = 'folder'


    /** Document a first launch renders before the Host answers. */
    const EMPTY_DOC = Object.freeze({
      version: 1,
      categories: [],
      view: { mode: 'categories', archived: 'default' },
      unassignedCollapsed: false,
      collapsedWorkspaces: [],
    })

    /* ------------------------------------------------------------------ */
    /* Icons — Client packages cannot be imported, so glyphs are inline     */
    /* ------------------------------------------------------------------ */

    /**
     * Build one 16-unit stroke glyph.
     * @param paths - one SVG path string, or a list drawn as separate strokes.
     * @param size - rendered square size in CSS pixels.
     * @param className - extra class on the root element.
     * @returns the glyph element.
     */
    function glyph(paths, size, className) {
      const list = Array.isArray(paths) ? paths : [paths]
      return h('svg', {
        viewBox: '0 0 16 16',
        width: size ?? 14,
        height: size ?? 14,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.4,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
        focusable: 'false',
        className: className === undefined ? 'wsx-glyph' : `wsx-glyph ${className}`,
      }, list.map((d, index) => h('path', { key: index, d })))
    }

    /**
     * Render one selectable category glyph by id.
     * @param id - glyph id, or an unknown value that falls back to the folder.
     * @param size - rendered square size in CSS pixels.
     * @returns the glyph element.
     */
    function glyphById(id, size) {
      const paths = GLYPHS[id] ?? GLYPHS[DEFAULT_GLYPH]
      return glyph(paths, size)
    }

    /** Closed and open folder shapes; the same outline, opened at the top-right. */
    const FOLDER_CLOSED = 'M2 5.6A1.6 1.6 0 0 1 3.6 4h2.1l1.2 1.5h5.5A1.6 1.6 0 0 1 14 7.1v4.3A1.6 1.6 0 0 1 12.4 13H3.6A1.6 1.6 0 0 1 2 11.4z'
    const FOLDER_OPEN = [
      'M2 11.4V5.6A1.6 1.6 0 0 1 3.6 4h2.1l1.2 1.5h5.5A1.6 1.6 0 0 1 14 7.1v.9',
      'M2 11.4 3.9 7.6A1.4 1.4 0 0 1 5.2 6.8h8.1a1 1 0 0 1 .9 1.4l-1.7 4a1.4 1.4 0 0 1-1.3.8H3.6A1.6 1.6 0 0 1 2 11.4z',
    ]

    const ICON = {
      folderClosed: (size, className) => glyph(FOLDER_CLOSED, size, className),
      folderOpen: (size, className) => glyph(FOLDER_OPEN, size, className),
      plus: size => glyph('M8 3.5v9M3.5 8h9', size),
      dots: size => glyph('M3 8h.01M8 8h.01M13 8h.01', size),
      search: size => glyph('M7.2 12.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4M11 11l2.4 2.4', size),
      sliders: size => glyph('M3 5.5h10M3 10.5h10M6 3.5v4M10 8.5v4', size),
      close: size => glyph('M4.5 4.5l7 7M11.5 4.5l-7 7', size),
      pin: size => glyph('M8 2.5l1.5 3.4 3.6.4-2.7 2.4.8 3.6L8 10.6l-3.2 1.7.8-3.6L2.9 6.3l3.6-.4z', size),
      check: size => glyph('M3.5 8.5l3 3 6-6', size),
      up: size => glyph('M8 12.5V4M4.5 7.5L8 4l3.5 3.5', size),
      down: size => glyph('M8 3.5V12M4.5 8.5L8 12l3.5-3.5', size),
    }

    /* ------------------------------------------------------------------ */
    /* Document helpers                                                    */
    /* ------------------------------------------------------------------ */

    /**
     * Build one immutable-document store.
     * @returns the store handle.
     */
    function createDocStore() {
      let current = EMPTY_DOC
      const listeners = new Set()
      return {
        get: () => current,
        subscribe(listener) {
          listeners.add(listener)
          return () => { listeners.delete(listener) }
        },
        replace(next) {
          current = next
          for (const listener of [...listeners]) listener()
        },
      }
    }

    /**
     * Copy a document into the exact shape the Host validates, so no write can
     * persist a hole or an unknown enum value.
     * @param doc - candidate document.
     * @returns the normalized document.
     */
    function normalize(doc) {
      const source = doc ?? {}
      const view = source.view ?? {}
      return {
        version: 1,
        categories: (source.categories ?? []).map(category => ({
          id: category.id,
          name: category.name,
          color: COLORS.includes(category.color) ? category.color : 'ink',
          icon: GLYPH_IDS.includes(category.icon) ? category.icon : DEFAULT_GLYPH,
          pinned: category.pinned === true,
          collapsed: category.collapsed === true,
          workspaceIds: [...(category.workspaceIds ?? [])],
        })),
        view: {
          tab: view.tab === 'recent' || view.tab === 'all' ? view.tab : 'categories',
          archived: view.archived === 'show' || view.archived === 'only' ? view.archived : 'default',
        },
        unassignedCollapsed: source.unassignedCollapsed === true,
        collapsedWorkspaces: (Array.isArray(source.collapsedWorkspaces) ? source.collapsedWorkspaces : [])
          .filter(id => typeof id === 'string' && id !== '')
          .filter((id, index, all) => all.indexOf(id) === index),
      }
    }

    /**
     * Mint a category id that cannot collide with an existing one.
     * @param categories - current categories.
     * @returns a fresh id.
     */
    function mintCategoryId(categories) {
      const taken = new Set(categories.map(category => category.id))
      let index = categories.length + 1
      while (taken.has(`c${index}`)) index += 1
      return `c${index}`
    }

    /**
     * Move one id within a list, inserting it before an anchor.
     * @param list - source order.
     * @param id - id to move.
     * @param before - anchor id, or undefined to append.
     * @returns the new order, or the same array when the move changes nothing.
     */
    function moved(list, id, before) {
      /* Dropping an item on its own top half names itself as the anchor; that
         gesture is a no-op, not "move to the end". */
      if (before === id) return list
      const from = list.indexOf(id)
      if (from === -1) return list
      const next = list.filter(entry => entry !== id)
      if (before === undefined) {
        if (from === list.length - 1) return list
        return [...next, id]
      }
      const at = next.indexOf(before)
      if (at === -1) return list
      if (at === from) return list
      next.splice(at, 0, id)
      return next
    }

    /**
     * Insert one id into a list at an anchor position. Unlike {@link moved} the
     * id need not already be present, which is what assigning a workspace to a
     * different category needs.
     * @param list - target order.
     * @param id - id to insert.
     * @param before - anchor id, or undefined to append.
     * @returns the new order, or the same array when nothing would change.
     */
    function inserted(list, id, before) {
      const next = list.filter(entry => entry !== id)
      if (before === undefined) {
        if (next.length === list.length && list[list.length - 1] === id) return list
        return [...next, id]
      }
      const at = next.indexOf(before)
      if (at === -1) return [...next, id]
      next.splice(at, 0, id)
      return next
    }

    /**
     * Assign a workspace to one category, removing it from any other. A
     * workspace is a member of at most one category.
     * @param categories - current categories.
     * @param workspaceId - workspace being moved.
     * @param categoryId - destination category id.
     * @param beforeId - anchor workspace inside the destination, or undefined.
     * @returns updated categories, or the input when the move changes nothing.
     */
    function assignWorkspace(categories, workspaceId, categoryId, beforeId) {
      if (beforeId === workspaceId) return categories
      const destination = categories.find(category => category.id === categoryId)
      if (destination === undefined) return categories
      const owner = categories.find(category => category.workspaceIds.includes(workspaceId))
      if (owner !== undefined && owner.id === categoryId) {
        /* Re-ordering inside one box: skip a write that would not move anything. */
        const next = moved(destination.workspaceIds, workspaceId, beforeId)
        if (next === destination.workspaceIds) return categories
      }
      return categories.map((category) => {
        const stripped = category.workspaceIds.filter(id => id !== workspaceId)
        if (category.id !== categoryId) {
          return stripped.length === category.workspaceIds.length
            ? category
            : { ...category, workspaceIds: stripped }
        }
        return { ...category, workspaceIds: inserted(stripped, workspaceId, beforeId) }
      })
    }

    /**
     * Drop a workspace from every category.
     * @param categories - current categories.
     * @param workspaceId - workspace leaving its category.
     * @returns updated categories.
     */
    function withoutWorkspace(categories, workspaceId) {
      return categories.map((category) => {
        const stripped = category.workspaceIds.filter(id => id !== workspaceId)
        return stripped.length === category.workspaceIds.length
          ? category
          : { ...category, workspaceIds: stripped }
      })
    }

    /**
     * Move one category to a new position among its own pinned group. Categories
     * render pinned-first, so a cross-group drop has no meaning to honour and is
     * refused by the caller.
     * @param categories - current categories.
     * @param categoryId - category being moved.
     * @param beforeId - anchor category id, or undefined to append.
     * @returns updated categories, or the input when the move changes nothing.
     */
    function reorderCategory(categories, categoryId, beforeId) {
      const source = categories.find(category => category.id === categoryId)
      if (source === undefined || beforeId === categoryId) return categories
      const anchor = beforeId === undefined ? undefined : categories.find(category => category.id === beforeId)
      if (anchor !== undefined && anchor.pinned !== source.pinned) return categories
      const groupIds = categories
        .filter(category => category.pinned === source.pinned)
        .map(category => category.id)
      const reordered = moved(groupIds, categoryId, beforeId)
      if (reordered === groupIds) return categories
      /* The stored array keeps both groups interleaved freely; only the
         positions of the moving group are rewritten, in display order. */
      let cursor = 0
      return categories.map((category) => {
        if (category.pinned !== source.pinned) return category
        const id = reordered[cursor]
        cursor += 1
        return categories.find(entry => entry.id === id) ?? category
      })
    }

    /* ------------------------------------------------------------------ */
    /* Overlay host                                                        */
    /* ------------------------------------------------------------------ */

    /**
     * Render overlay content into `document.body`, because the sidebar is a
     * containment context in which `position: fixed` resolves to the sidebar.
     * @param children - overlay nodes.
     * @returns the portal.
     */
    function Overlay({ children }) {
      return ReactDOM.createPortal(children, document.body)
    }

    /* ------------------------------------------------------------------ */
    /* Presentational pieces                                               */
    /* ------------------------------------------------------------------ */

    /**
     * One modal: Escape and backdrop dismiss, Enter commits, initial focus seat,
     * Tab confined to the dialog, focus returned to the invoker on close.
     * @param props - open request, busy flag, locale seat, and settlement.
     * @returns the dialog overlay, or null while closed.
     */
    function Dialog({ request, busy, t, onCancel, onSettle }) {
      const [value, setValue] = React.useState('')
      const ref = React.useRef(null)
      const restoreRef = React.useRef(null)
      React.useEffect(() => {
        if (request === null) return undefined
        setValue(request.initial ?? '')
        restoreRef.current = document.activeElement
        const onKey = (event) => {
          if (event.key === 'Escape') {
            event.stopPropagation()
            onCancel()
            return
          }
          if (event.key !== 'Tab' || ref.current === null) return
          const seats = [...ref.current.querySelectorAll('button, input')]
            .filter(node => !node.disabled)
          if (seats.length === 0) return
          const first = seats[0]
          const last = seats[seats.length - 1]
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault()
            last.focus()
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault()
            first.focus()
          }
        }
        document.addEventListener('keydown', onKey, true)
        return () => {
          document.removeEventListener('keydown', onKey, true)
          const restore = restoreRef.current
          restoreRef.current = null
          if (restore !== null && typeof restore.focus === 'function' && document.contains(restore)) {
            restore.focus({ preventScroll: true })
          }
        }
      }, [request, onCancel])
      React.useEffect(() => {
        if (request === null) return
        const seat = ref.current?.querySelector('[data-wsx-autofocus]')
        if (seat === null || seat === undefined) return
        seat.focus({ preventScroll: true })
        if (typeof seat.select === 'function') seat.select()
      }, [request])
      if (request === null) return null
      const isName = request.kind === 'name'
      const isAppearance = request.kind === 'appearance'
      const blocked = busy || (isName && value.trim() === '')

      /**
       * One appearance picker: a swatch grid and a glyph grid. Selecting either
       * applies immediately, because the change is reversible and the dialog
       * stays open so both axes can be set in one visit.
       * @returns the picker body.
       */
      const appearanceBody = () => {
        const draft = request.draft
        /* The whole picker carries the draft tone, so the glyph grid previews the
           chosen colour and the swatches can read --wsx-accent. */
        return h('div', { className: `wsx-appearance wsx-tone-${draft.color}` },
          h('div', { className: 'wsx-appearance-label' }, t('dialog.color')),
          h('div', { className: 'wsx-swatches', role: 'radiogroup', 'aria-label': t('dialog.color') },
            COLORS.map(color => h('button', {
              key: color,
              type: 'button',
              role: 'radio',
              'aria-checked': draft.color === color,
              'aria-label': t(`color.${color}`),
              title: t(`color.${color}`),
              className: draft.color === color ? 'wsx-swatch wsx-swatch-on' : 'wsx-swatch',
              onClick: () => request.onDraft({ ...draft, color }),
            }, h('span', { className: `wsx-swatch-fill wsx-tone-${color}` })))),
          h('div', { className: 'wsx-appearance-label' }, t('dialog.icon')),
          h('div', { className: 'wsx-glyphgrid', role: 'radiogroup', 'aria-label': t('dialog.icon') },
            GLYPH_IDS.map(id => h('button', {
              key: id,
              type: 'button',
              role: 'radio',
              'aria-checked': draft.icon === id,
              'aria-label': t('dialog.iconName'),
              title: id,
              className: draft.icon === id ? 'wsx-glyphcell wsx-glyphcell-on' : 'wsx-glyphcell',
              onClick: () => request.onDraft({ ...draft, icon: id }),
            }, glyphById(id, 16)))))
      }

      return h(Overlay, null,
        h('div', {
          className: 'wsx-scrim',
          onMouseDown: (event) => { if (event.target === event.currentTarget) onCancel() },
        },
        h('div', {
          className: isAppearance ? 'wsx-dialog wsx-dialog-wide' : 'wsx-dialog',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': request.title,
          ref,
        },
          h('div', { className: 'wsx-dialog-title' }, request.title),
          isName
            ? h('input', {
              className: 'wsx-dialog-input',
              value,
              'data-wsx-autofocus': '',
              'aria-label': request.title,
              placeholder: request.placeholder ?? '',
              maxLength: 80,
              disabled: busy,
              onChange: event => setValue(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                event.preventDefault()
                if (!blocked) onSettle(value)
              },
            })
            : isAppearance
              ? appearanceBody()
              : h('div', { className: 'wsx-dialog-body' }, request.body),
          h('div', { className: 'wsx-dialog-actions' },
            h('button', { type: 'button', className: 'wsx-btn', onClick: onCancel, disabled: busy }, t('dialog.cancel')),
            h('button', {
              type: 'button',
              className: request.danger === true ? 'wsx-btn wsx-btn-danger' : 'wsx-btn wsx-btn-primary',
              'data-wsx-autofocus': isName || isAppearance ? undefined : '',
              onClick: () => { if (!blocked) onSettle(value) },
              disabled: blocked,
            }, request.confirmLabel)))))
    }

    /**
     * One anchored popup menu rendered at viewport coordinates: outside press,
     * Escape, and selection dismiss it, and the arrow keys walk its rows.
     * A row carrying `replaceWith` swaps the popup's rows in place, which is how
     * a submenu works here: closing and re-opening would race the dismissal.
     * @param props - open menu and its dismissal, plus the local row swap.
     * @returns the menu overlay, or null while closed.
     */
    function PopupMenu({ menu, onClose, onActivate }) {
      const ref = React.useRef(null)
      React.useEffect(() => {
        if (menu === null) return undefined
        const onDown = (event) => {
          if (ref.current !== null && ref.current.contains(event.target)) return
          onClose()
        }
        const onKey = (event) => {
          if (event.key === 'Escape') {
            onClose()
            return
          }
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          if (ref.current === null) return
          const rows = [...ref.current.querySelectorAll('[role="menuitem"]:not(:disabled)')]
          if (rows.length === 0) return
          event.preventDefault()
          const at = rows.indexOf(document.activeElement)
          const next = event.key === 'ArrowDown'
            ? rows[(at + 1) % rows.length]
            : rows[(at - 1 + rows.length) % rows.length]
          next.focus()
        }
        document.addEventListener('mousedown', onDown, true)
        document.addEventListener('keydown', onKey, true)
        const first = ref.current?.querySelector('[role="menuitem"]:not(:disabled)')
        first?.focus({ preventScroll: true })
        return () => {
          document.removeEventListener('mousedown', onDown, true)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [menu, onClose])
      if (menu === null) return null
      const rows = menu.items
      const style = {
        left: Math.max(8, Math.min(menu.point.x, window.innerWidth - 252)),
        top: Math.max(8, Math.min(menu.point.y, window.innerHeight - 16 - Math.min(rows.length, 14) * 34)),
        maxHeight: Math.max(160, window.innerHeight - 24),
      }
      return h(Overlay, null,
        h('div', { className: 'wsx-menu', role: 'menu', ref, style },
          rows.map((item, index) => (item.separator === true
            ? h('div', { key: `sep-${index}`, className: 'wsx-menu-sep', role: 'separator' })
            : h('button', {
              key: item.id,
              type: 'button',
              role: 'menuitem',
              className: item.danger === true ? 'wsx-menu-item wsx-menu-danger' : 'wsx-menu-item',
              disabled: item.disabled === true,
              onClick: () => {
                /* A submenu row swaps this popup's own rows and leaves it open;
                   every other row runs once and the popup closes. */
                onActivate(item)
              },
            },
            h('span', { className: 'wsx-menu-icon' }, item.icon ?? null),
            h('span', { className: 'wsx-menu-label' }, item.label),
            item.checked === true ? h('span', { className: 'wsx-menu-check' }, ICON.check(12)) : null)))))
    }

    /**
     * Compact relative time for one row.
     * @param updatedAt - epoch milliseconds.
     * @param now - current epoch milliseconds.
     * @param t - the locale seat.
     * @returns the label.
     */
    function timeLabel(updatedAt, now, t) {
      const minutes = Math.max(0, Math.round((now - updatedAt) / 60000))
      if (minutes < 1) return t('time.now')
      if (minutes < 60) return t('time.minutes', { n: minutes })
      const hours = Math.round(minutes / 60)
      if (hours < 24) return t('time.hours', { n: hours })
      const days = Math.round(hours / 24)
      if (days < 30) return t('time.days', { n: days })
      return t('time.months', { n: Math.round(days / 30) })
    }

    /* ------------------------------------------------------------------ */
    /* The browsing region                                                 */
    /* ------------------------------------------------------------------ */

    /**
     * Categorised workspace browser filling `sidebar.workspaces`.
     * @param props - shell owner share, standard hooks, locale seat, injected
     *   actions and document store, and the shared context-menu bindings.
     * @returns the browsing region.
     */
    function WorkspaceSkin(props) {
      const {
        wide, expandSidebar, useSessions, useWorkspaces, useSessionStatus, usePanelInfo,
        useContextMenu, renderSlot, t, actions, docStore, saveStore,
      } = props
      const doc = React.useSyncExternalStore(docStore.subscribe, docStore.get, docStore.get)
      const saveFailure = React.useSyncExternalStore(saveStore.subscribe, saveStore.get, saveStore.get)
      const workspaceState = useWorkspaces(state => state)
      const list = useSessions(state => state)
      const statuses = useSessionStatus(state => state)
      const panelActive = usePanelInfo(info => info.activePanelId !== null)
      const { getTriggerProps } = useContextMenu()

      /**
       * Render one child slot the shipped browser would have rendered. This package
       * replaces the whole browsing region, so an extension that seats itself in a
       * session row loses its host unless we reproduce those seats.
       * @param key - child slot key.
       * @param slotProps - props the shipped browser passes to that seat.
       * @returns the seated entries, or null when the seat is unavailable.
       */
      const childSlot = (key, slotProps) => {
        if (typeof renderSlot !== 'function') return null
        let rendered
        try {
          rendered = renderSlot(key, slotProps)
        } catch {
          /* The call itself failed (undeclared seat, bad props): skip it. */
          return null
        }
        /* An empty array means nobody is seated; emitting a wrapper would add
           dead flex items to every row. */
        if (rendered === null || rendered === undefined) return null
        if (Array.isArray(rendered) && rendered.length === 0) return null
        /* No boundary available (older React seed): render the seat unwrapped
           rather than refusing to show it. */
        return SeatBoundary === null ? rendered : h(SeatBoundary, { key }, rendered)
      }

      const [query, setQuery] = React.useState('')
      const [menu, setMenu] = React.useState(null)
      /** Latest open menu, read by callbacks that must not depend on render order. */
      const menuRef = React.useRef(null)
      menuRef.current = menu
      const [dialog, setDialog] = React.useState(null)
      const [drag, setDrag] = React.useState(null)
      const [dropHint, setDropHint] = React.useState(null)
      const [limits, setLimits] = React.useState({})
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)
      const dragRef = React.useRef(null)
      const pressRef = React.useRef(null)
      const closeMenu = React.useCallback(() => setMenu(null), [])
      /**
       * Run one menu row. A row that carries `replaceWith` opens its submenu by
       * replacing the popup's rows at the same anchor and keeps it open; every
       * other row performs its action once and closes the popup.
       * Side effects stay out of the state updater, so React may render or
       * replay the update without repeating them.
       * @param item - the activated row.
       */
      const activateMenuItem = React.useCallback((item) => {
        const open = menuRef.current
        if (typeof item.replaceWith === 'function' && open !== null) {
          setMenu({ point: open.point, items: item.replaceWith(open.point) })
          return
        }
        setMenu(null)
        item.run?.()
      }, [])
      const closeDialog = React.useCallback(() => setDialog(null), [])

      const now = Date.now()
      const currentSessionId = panelActive
        ? undefined
        : Object.values(list.byId).find(session => (session.retainedBy.mainView ?? 0) > 0)?.id

      const archivedSet = React.useMemo(
        () => new Set(workspaceState.archivedSessionIds),
        [workspaceState.archivedSessionIds],
      )
      const pinnedSet = React.useMemo(
        () => new Set(workspaceState.pinnedSessionIds),
        [workspaceState.pinnedSessionIds],
      )
      const workspaces = workspaceState.items
      const byWorkspaceId = React.useMemo(
        () => new Map(workspaces.map(workspace => [workspace.workspaceId, workspace])),
        [workspaces],
      )

      /**
       * Display title for one workspace: its stored title, else the directory
       * name, so an automatically named workspace is never a blank row.
       * @param workspace - the workspace row.
       * @returns the label.
       */
      const workspaceTitle = (workspace) => {
        if (typeof workspace.title === 'string' && workspace.title.trim() !== '') return workspace.title
        const parts = workspace.path.split(/[\\/]+/).filter(part => part !== '')
        return parts.length === 0 ? workspace.path : parts[parts.length - 1]
      }

      /** Categories in display order: pinned ones lead, each group keeps the stored order. */
      const orderedCategories = React.useMemo(() => [
        ...doc.categories.filter(category => category.pinned),
        ...doc.categories.filter(category => !category.pinned),
      ], [doc.categories])

      /** Workspaces that belong to no category. */
      const unassigned = React.useMemo(() => {
        const assigned = new Set(doc.categories.flatMap(category => category.workspaceIds))
        return workspaces.filter(workspace => !assigned.has(workspace.workspaceId))
      }, [doc.categories, workspaces])

      /** Sessions accounted to no workspace, so they stay reachable. */
      const orphanSessionIds = React.useMemo(() => {
        const accounted = new Set(workspaces.flatMap(workspace => workspace.sessionIds))
        return list.ids.filter(id => !accounted.has(id) && list.byId[id] !== undefined)
      }, [list, workspaces])

      const normalizedQuery = query.trim().toLowerCase()
      /** A query opens folded boxes and lifts the per-box row limit. */
      const searching = normalizedQuery !== ''

      /* ---------------------------------------------------------------- */
      /* Long-press drag                                                   */
      /* ---------------------------------------------------------------- */

      const cancelPress = React.useCallback(() => {
        const pending = pressRef.current
        if (pending === null) return
        window.clearTimeout(pending.timer)
        window.removeEventListener('pointermove', pending.move, true)
        window.removeEventListener('pointerup', pending.up, true)
        window.removeEventListener('pointercancel', pending.up, true)
        pressRef.current = null
      }, [])

      /** Start a press: hold still for LONG_PRESS_MS and a drag begins. */
      const beginPress = React.useCallback((event, payload) => {
        if (event.button !== 0 || payload.disabled === true) return
        const origin = { x: event.clientX, y: event.clientY }
        cancelPress()
        const move = (moveEvent) => {
          if (Math.abs(moveEvent.clientX - origin.x) > LONG_PRESS_SLOP_PX
            || Math.abs(moveEvent.clientY - origin.y) > LONG_PRESS_SLOP_PX) cancelPress()
        }
        const timer = window.setTimeout(() => {
          cancelPress()
          const active = { ...payload, x: origin.x, y: origin.y }
          dragRef.current = active
          setDrag(active)
          document.body.style.userSelect = 'none'
        }, LONG_PRESS_MS)
        const up = () => { cancelPress() }
        pressRef.current = { timer, move, up }
        window.addEventListener('pointermove', move, true)
        window.addEventListener('pointerup', up, true)
        window.addEventListener('pointercancel', up, true)
      }, [cancelPress])

      /**
       * End the drag without committing: Escape, a lost pointer, or a window
       * blur must never leave the ghost or the text-selection lock behind.
       */
      const abortDrag = React.useCallback(() => {
        dragRef.current = null
        setDrag(null)
        setDropHint(null)
        document.body.style.userSelect = ''
      }, [])

      React.useEffect(() => {
        if (drag === null) return undefined
        const drop = (event) => {
          const active = dragRef.current
          if (active !== null) {
            const hint = resolveDropHint(active, event.clientX, event.clientY)
            if (hint !== null) {
              if (active.kind === 'workspace') {
                actions.moveWorkspace(active.workspaceId, hint.categoryId, hint.beforeId)
              } else {
                actions.moveCategory(active.categoryId, hint.beforeCategoryId)
              }
            }
          }
          abortDrag()
        }
        const onMove = (event) => {
          const active = dragRef.current
          if (active === null) return
          setDrag({ ...active, x: event.clientX, y: event.clientY })
          setDropHint(resolveDropHint(active, event.clientX, event.clientY))
        }
        const onKey = (event) => {
          if (event.key !== 'Escape') return
          event.preventDefault()
          abortDrag()
        }
        window.addEventListener('pointermove', onMove, true)
        window.addEventListener('pointerup', drop, true)
        window.addEventListener('pointercancel', abortDrag, true)
        window.addEventListener('blur', abortDrag)
        document.addEventListener('keydown', onKey, true)
        return () => {
          window.removeEventListener('pointermove', onMove, true)
          window.removeEventListener('pointerup', drop, true)
          window.removeEventListener('pointercancel', abortDrag, true)
          window.removeEventListener('blur', abortDrag)
          document.removeEventListener('keydown', onKey, true)
        }
      }, [drag === null, actions, abortDrag])

      React.useEffect(() => () => {
        cancelPress()
        document.body.style.userSelect = ''
      }, [cancelPress])

      /**
       * Resolve the drop seat under a viewport point from the rendered DOM.
       *
       * Only real seats accept a drop: a workspace row names the row it inserts
       * before, a box names its own append position, and the Unassigned box is
       * the one deliberate way to unfile. The gaps between boxes and the empty
       * tail of the list are not seats, so a sloppy release changes nothing.
       * @param active - the drag in flight.
       * @param x - viewport x.
       * @param y - viewport y.
       * @returns the resolved seat, or null when the point is not a valid one.
       */
      function resolveDropHint(active, x, y) {
        const element = document.elementFromPoint(x, y)
        if (element === null) return null
        const box = element.closest('[data-wsx-cat]')
        if (active.kind === 'category') {
          if (box === null) return null
          const anchorId = box.getAttribute('data-wsx-cat')
          if (anchorId === UNASSIGNED || anchorId === OTHER_SESSIONS) return null
          const moving = doc.categories.find(category => category.id === active.categoryId)
          const anchor = doc.categories.find(category => category.id === anchorId)
          /* Pinned boxes always render first, so a cross-group drop would be a
             silent no-op; refuse it instead of pretending it worked. */
          if (moving === undefined || anchor === undefined || moving.pinned !== anchor.pinned) return null
          const ids = orderedCategories
            .filter(category => category.pinned === moving.pinned)
            .map(category => category.id)
          const index = ids.indexOf(anchorId)
          if (index === -1) return null
          const rect = box.getBoundingClientRect()
          const after = y > rect.top + rect.height / 2
          return { categoryId: anchorId, beforeCategoryId: ids[index + (after ? 1 : 0)] }
        }
        if (box === null) return null
        const categoryId = box.getAttribute('data-wsx-cat')
        const rows = [...box.querySelectorAll('[data-wsx-item]')]
        const row = element.closest('[data-wsx-item]')
        /* Hovering the dragged row itself is never a seat: it would only ever
           resolve to a no-op, and showing a marker there reads as a bug. */
        if (row !== null && row.getAttribute('data-wsx-item') === active.workspaceId) return null
        if (row === null || !rows.includes(row)) return { categoryId, beforeId: undefined, append: true }
        const ids = rows.map(node => node.getAttribute('data-wsx-item'))
        const index = ids.indexOf(row.getAttribute('data-wsx-item'))
        const rect = row.getBoundingClientRect()
        /* Split on the row's own midline so every row is one clear before/after
           choice, which is what makes free re-ordering predictable. */
        const after = y > rect.top + rect.height / 2
        const beforeId = ids[index + (after ? 1 : 0)]
        return { categoryId, beforeId, append: after && beforeId === undefined }
      }

      /* ---------------------------------------------------------------- */
      /* Actions                                                           */
      /* ---------------------------------------------------------------- */

      const flashError = (reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      }

      const run = (task) => {
        setError(null)
        setBusy(true)
        Promise.resolve()
          .then(task)
          .catch(flashError)
          .finally(() => { setBusy(false) })
      }

      /**
       * Open a menu against the invoking control. A keyboard activation reports
       * (0, 0), so the anchor rectangle is the reliable source.
       * @param event - the activating event.
       * @param items - menu rows.
       */
      const openMenuAt = (event, items) => {
        event.preventDefault()
        event.stopPropagation()
        const rect = event.currentTarget?.getBoundingClientRect?.()
        const point = event.clientX === 0 && event.clientY === 0 && rect !== undefined
          ? { x: rect.left, y: rect.bottom }
          : { x: event.clientX, y: event.clientY }
        setMenu({ point, items })
      }

      /** Open the name prompt and hand the trimmed value to `commit`. */
      const askName = (title, initial, commit) => {
        setDialog({
          kind: 'name',
          title,
          initial,
          confirmLabel: t('dialog.save'),
          onCommit: (value) => { commit(value.trim()) },
        })
      }

      /** Categories that currently hold a workspace. */
      const categoriesOwning = workspaceId =>
        doc.categories.filter(category => category.workspaceIds.includes(workspaceId))

      const moveCategoryBy = (categoryId, delta) => {
        const source = doc.categories.find(category => category.id === categoryId)
        if (source === undefined) return
        const group = orderedCategories.filter(category => category.pinned === source.pinned)
        const at = group.findIndex(category => category.id === categoryId)
        const target = at + delta
        if (target < 0 || target >= group.length) return
        /* Re-insert before the neighbour the move must end up above. */
        const before = delta > 0 ? group[target + 1]?.id : group[target].id
        actions.moveCategory(categoryId, before)
      }

      const categoryMenuItems = (category) => {
        const group = orderedCategories.filter(entry => entry.pinned === category.pinned)
        const at = group.findIndex(entry => entry.id === category.id)
        return [
          {
            id: 'rename',
            label: t('menu.renameCategory'),
            run: () => askName(t('dialog.renameCategory'), category.name, (name) => {
              if (name !== '') actions.renameCategory(category.id, name)
            }),
          },
          {
            id: 'pin',
            label: category.pinned ? t('menu.unpinCategory') : t('menu.pinCategory'),
            run: () => { actions.toggleCategoryPinned(category.id) },
          },
          {
            id: 'fold',
            label: category.collapsed ? t('menu.expandCategory') : t('menu.collapseCategory'),
            run: () => { actions.toggleCategoryCollapsed(category.id) },
          },
          { id: 'move-sep', separator: true },
          {
            id: 'up',
            label: t('menu.moveUp'),
            icon: ICON.up(12),
            disabled: at <= 0,
            run: () => { moveCategoryBy(category.id, -1) },
          },
          {
            id: 'down',
            label: t('menu.moveDown'),
            icon: ICON.down(12),
            disabled: at === -1 || at >= group.length - 1,
            run: () => { moveCategoryBy(category.id, 1) },
          },
          { id: 'look-sep', separator: true },
          {
            id: 'appearance',
            label: t('menu.appearance'),
            icon: glyphById(category.icon, 12),
            run: () => {
              setDialog({
                kind: 'appearance',
                title: t('dialog.appearance'),
                confirmLabel: t('dialog.done'),
                draft: { color: category.color, icon: category.icon },
                onDraft: (draft) => {
                  /* Apply on each pick so the box updates behind the dialog. */
                  actions.setCategoryColor(category.id, draft.color)
                  actions.setCategoryIcon(category.id, draft.icon)
                  setDialog(current => (current === null ? current : { ...current, draft }))
                },
                onCommit: () => { /* Every pick was already applied. */ },
              })
            },
          },
          { id: 'delete-sep', separator: true },
          {
            id: 'delete',
            label: t('menu.deleteCategory'),
            danger: true,
            run: () => {
              setDialog({
                kind: 'confirm',
                title: t('dialog.deleteCategory'),
                body: t('dialog.deleteCategoryBody', { name: category.name }),
                confirmLabel: t('dialog.delete'),
                danger: true,
                onCommit: () => { actions.deleteCategory(category.id) },
              })
            },
          },
        ]
      }

      const workspaceMenuItems = (workspace) => {
        const owners = categoriesOwning(workspace.workspaceId)
        const items = [
          {
            id: 'new-session',
            label: t('menu.newSession'),
            run: () => { actions.startSession(workspace.workspaceId) },
          },
          { id: 'sep-1', separator: true },
        ]
        if (doc.categories.length > 0 || owners.length > 0) {
          items.push({
            id: 'move',
            label: t('menu.moveToCategory'),
            /* `keepOpen` swaps the rows of the popup in place instead of closing
               it: the item list is owned by this menu, not by a second popup. */
            keepOpen: true,
            replaceWith: (point) => [
              ...doc.categories.map(category => ({
                id: `to-${category.id}`,
                label: category.name,
                checked: owners.some(owner => owner.id === category.id),
                run: () => { actions.moveWorkspace(workspace.workspaceId, category.id, undefined) },
              })),
              ...(owners.length === 0 ? [] : [{
                id: 'unassign',
                label: t('menu.removeFromCategory'),
                run: () => { actions.unassignWorkspace(workspace.workspaceId) },
              }]),
              { id: 'sub-back', separator: true },
              {
                id: 'sub-cancel',
                label: t('menu.back'),
                run: () => { /* Closing the popup is the whole action. */ },
              },
            ],
          })
        }
        items.push(
          {
            id: 'fold',
            label: doc.collapsedWorkspaces.includes(workspace.workspaceId)
              ? t('menu.expandWorkspace')
              : t('menu.collapseWorkspace'),
            run: () => { actions.toggleWorkspaceCollapsed(workspace.workspaceId) },
          },
          { id: 'sep-fold', separator: true },
          {
            id: 'rename',
            label: t('menu.renameWorkspace'),
            run: () => askName(t('dialog.renameWorkspace'), workspaceTitle(workspace), (name) => {
              if (name !== '') run(() => actions.renameWorkspace(workspace.workspaceId, name))
            }),
          },
          { id: 'sep-2', separator: true },
          {
            id: 'delete',
            label: t('menu.deleteWorkspace'),
            danger: true,
            run: () => {
              setDialog({
                kind: 'confirm',
                title: t('dialog.deleteWorkspace'),
                body: t('dialog.deleteWorkspaceBody', { name: workspaceTitle(workspace) }),
                confirmLabel: t('dialog.delete'),
                danger: true,
                onCommit: () => { run(() => actions.deleteWorkspace(workspace.workspaceId)) },
              })
            },
          },
        )
        return items
      }

      /* ---------------------------------------------------------------- */
      /* Rendering                                                        */
      /* ---------------------------------------------------------------- */

      /**
       * Filter one membership list into displayable rows.
       * @param membership - session ids claimed by the owner.
       * @returns rows sorted pinned-first, then by recency.
       */
      function rowsOf(membership) {
        const rows = membership.flatMap((id) => {
          const summary = list.byId[id]
          if (summary === undefined) return []
          /* Subagent children are conversation internals, not sidebar entries. */
          if (summary.origin === 'subagent') return []
          /* One reusable blank row belongs to the New Session view; showing it
             in every box would invent a session that does not exist yet. */
          if (summary.blank && id !== currentSessionId) return []
          const archived = archivedSet.has(id)
          if (doc.view.archived === 'default' && archived) return []
          if (doc.view.archived === 'only' && !archived) return []
          if (searching && !summary.displayTitle.toLowerCase().includes(normalizedQuery)) return []
          return [{ summary, archived }]
        })
        rows.sort((left, right) => {
          const leftPinned = pinnedSet.has(left.summary.id) && !left.archived
          const rightPinned = pinnedSet.has(right.summary.id) && !right.archived
          if (leftPinned !== rightPinned) return leftPinned ? -1 : 1
          return right.summary.updatedAt - left.summary.updatedAt
        })
        return rows
      }

      const appendLine = (categoryId) => {
        if (dropHint === null || dropHint.append !== true || dropHint.categoryId !== categoryId) return null
        return h('div', { className: 'wsx-append-line', 'aria-hidden': 'true' })
      }

      /** The category currently being dragged, so its bar can dim while in flight. */
      const draggingCategoryId = drag !== null && drag.kind === 'category' ? drag.categoryId : null

      /**
       * One category as a compact coloured bar: accent strip, glyph, name, count.
       * Its workspaces hang below on an indent guide, so the hierarchy reads as
       * category → workspace → session without nested boxes.
       * @param category - the category to draw.
       * @returns the category element.
       */
      const renderCategoryBox = (category) => {
        const members = category.workspaceIds.flatMap((id) => {
          const workspace = byWorkspaceId.get(id)
          return workspace === undefined ? [] : [workspace]
        })
        /* A query opens folded bars so a match is never hidden by a fold. */
        const folded = category.collapsed && !searching
        const dropped = dropHint !== null && dropHint.categoryId === category.id
        const classes = ['wsx-cat', 'wsx-bar', `wsx-tone-${category.color}`]
        if (draggingCategoryId === category.id) classes.push('wsx-cat-dragging')
        if (dropped) classes.push('wsx-cat-drop')
        return h('div', {
          key: category.id,
          className: classes.join(' '),
          'data-wsx-cat': category.id,
          role: 'treeitem',
          'aria-level': 1,
          'aria-expanded': !folded,
        },
        h('div', {
          className: 'wsx-cat-head wsx-grab',
          onPointerDown: event => beginPress(event, {
            kind: 'category',
            categoryId: category.id,
            disabled: event.target.closest('button') !== null,
          }),
        },
        h('button', {
          type: 'button',
          className: 'wsx-cat-fold',
          'aria-expanded': !folded,
          'aria-label': folded ? t('menu.expandCategory') : t('menu.collapseCategory'),
          title: folded ? t('menu.expandCategory') : t('menu.collapseCategory'),
          onClick: (event) => {
            event.stopPropagation()
            actions.toggleCategoryCollapsed(category.id)
          },
        }, h('span', { className: 'wsx-cat-glyph' }, glyphById(category.icon, 18))),
        h('span', { className: 'wsx-cat-name' }, category.name),
        category.pinned
          ? h('span', { className: 'wsx-cat-pin', 'aria-hidden': 'true' }, ICON.pin(12))
          : null,
        h('span', { className: 'wsx-cat-badge' }, String(members.length)),
        /* Creates a workspace straight into this category, so filing is part of
           creating rather than a second drag afterwards. */
        h('button', {
          type: 'button',
          className: 'wsx-icon-btn wsx-cat-add',
          'aria-label': t('menu.addWorkspaceToCategory'),
          title: t('menu.addWorkspaceToCategory'),
          onClick: (event) => {
            event.stopPropagation()
            addWorkspaceToCategory(category.id)
          },
        }, ICON.plus(14)),
        h('button', {
          type: 'button',
          className: 'wsx-icon-btn',
          'aria-label': t('menu.categoryActions'),
          title: t('menu.categoryActions'),
          onClick: event => openMenuAt(event, categoryMenuItems(category)),
        }, ICON.dots(14))),
        folded
          ? null
          : h('div', { className: 'wsx-cat-body' },
            members.length === 0
              ? h('div', { className: 'wsx-cat-empty' },
                searching ? t('box.noMatches') : t('box.emptyCategory'))
              : members.map(workspace =>
                renderWorkspace(category.id, workspace, rowsOf(workspace.sessionIds), true)),
            appendLine(category.id)))
      }

      /**
       * The unassigned bucket, demoted to a collapsible footer entry: it is a
       * catch-all, not a peer of the categories the user made.
       * @returns the footer entry, or null when nothing is unassigned.
       */
      const renderUnassigned = () => {
        if (unassigned.length === 0) return null
        const folded = doc.unassignedCollapsed && !searching
        const dropped = dropHint !== null && dropHint.categoryId === UNASSIGNED
        const classes = ['wsx-cat', 'wsx-bar', 'wsx-bar-footer', 'wsx-tone-slate']
        if (dropped) classes.push('wsx-cat-drop')
        return h('div', {
          key: UNASSIGNED,
          className: classes.join(' '),
          'data-wsx-cat': UNASSIGNED,
          role: 'treeitem',
          'aria-level': 1,
          'aria-expanded': !folded,
        },
        h('div', { className: 'wsx-cat-head' },
          h('button', {
            type: 'button',
            className: 'wsx-cat-fold',
            'aria-expanded': !folded,
            'aria-label': folded ? t('menu.expandCategory') : t('menu.collapseCategory'),
            title: folded ? t('menu.expandCategory') : t('menu.collapseCategory'),
            onClick: () => { actions.toggleUnassignedCollapsed() },
          }, h('span', { className: 'wsx-cat-glyph' }, glyphById('list', 18))),
          h('span', { className: 'wsx-cat-name' }, t('section.unassigned')),
          h('span', { className: 'wsx-cat-badge' }, String(unassigned.length))),
        folded
          ? null
          : h('div', { className: 'wsx-cat-body' },
            unassigned.map(workspace =>
              renderWorkspace(UNASSIGNED, workspace, rowsOf(workspace.sessionIds), true)),
            appendLine(UNASSIGNED)))
      }

      const renderOtherSessions = () => {
        const rows = rowsOf(orphanSessionIds)
        if (rows.length === 0) return null
        return h('div', {
          key: OTHER_SESSIONS,
          className: 'wsx-cat wsx-bar wsx-bar-footer wsx-tone-slate',
          'data-wsx-cat': OTHER_SESSIONS,
          role: 'treeitem',
          'aria-level': 1,
        }, h('div', { className: 'wsx-cat-head' },
          h('span', { className: 'wsx-cat-glyph', 'aria-hidden': 'true' },
            glyphById('list', 18)),
          h('span', { className: 'wsx-cat-name' }, t('section.otherSessions')),
          h('span', { className: 'wsx-cat-badge' }, String(rows.length))),
        h('div', { className: 'wsx-cat-body' },
          renderWorkspace(OTHER_SESSIONS, undefined, rows, false)))
      }

      /** Every session of every workspace plus the orphans, newest first. */
      const renderAllSessions = () => {
        const memberships = [...workspaces.map(workspace => workspace.sessionIds), orphanSessionIds]
        const rows = memberships
          .flatMap(membership => rowsOf(membership))
          .sort((left, right) => right.summary.updatedAt - left.summary.updatedAt)
        if (rows.length === 0) {
          return h('div', { className: 'wsx-cat-empty' },
            searching ? t('box.noMatches') : t('box.noSessions'))
        }
        return h('div', { className: 'wsx-guide wsx-guide-flat' }, rows.map(row => renderSession(row)))
      }

      /** The Recent tab: frequent workspaces first, each with its newest rows. */
      const renderRecent = () => {
        if (recentWorkspaces.length === 0) {
          return h('div', { className: 'wsx-cat-empty' }, t('section.noRecent'))
        }
        return h('div', { className: 'wsx-recent' },
          recentWorkspaces.map(workspace =>
            renderWorkspace('__recent__', workspace, rowsOf(workspace.sessionIds), false)))
      }

      const addWorkspace = () => {
        run(async () => {
          const path = await actions.pickDirectory()
          if (path === null || path === undefined) return
          await actions.createWorkspace(path)
        })
      }

      /**
       * Create a workspace and file it into one category in a single gesture.
       *
       * The new workspace's id is not always returned by the create call, so when
       * it is missing the workspace is located by its directory path. Without that
       * fallback the workspace would be created but land in Unassigned, which is
       * exactly the manual step this button exists to remove.
       * @param categoryId - category to file the new workspace into.
       */
      const addWorkspaceToCategory = (categoryId) => {
        run(async () => {
          const path = await actions.pickDirectory()
          if (path === null || path === undefined) return
          const createdId = await actions.createWorkspace(path)
          if (typeof createdId === 'string' && createdId !== '') {
            actions.moveWorkspaceIntoCategory(createdId, categoryId)
            return
          }
          /* Fallback: compare the picked directory against the workspace list. */
          const normalized = String(path).replace(/[\\/]+$/, '').toLowerCase()
          const match = workspaceState.items.find((workspace) => {
            const own = String(workspace.path ?? '').replace(/[\\/]+$/, '').toLowerCase()
            return own === normalized
          })
          if (match !== undefined) {
            actions.moveWorkspaceIntoCategory(match.workspaceId, categoryId)
            return
          }
          setError(t('box.createdButUnfiled'))
        })
      }

      const viewMenuItems = () => [
        ...[
          ['default', t('view.hideArchived')],
          ['show', t('view.showArchived')],
          ['only', t('view.onlyArchived')],
        ].map(([value, label]) => ({
          id: `archived-${value}`,
          label,
          checked: doc.view.archived === value,
          run: () => { actions.setView({ archived: value }) },
        })),
      ]

      /* ---------------------------------------------------------------- */
      /* Tabs and the recent list                                          */
      /* ---------------------------------------------------------------- */

      /**
       * Most-recently-used workspaces, newest session first. Feeds the Recent
       * tab, which is how a frequent workspace is reached without hunting
       * through its category.
       */
      const recentWorkspaces = React.useMemo(() => {
        const newest = new Map()
        for (const workspace of workspaces) {
          let best = 0
          for (const id of workspace.sessionIds) {
            const summary = list.byId[id]
            if (summary === undefined) continue
            if (archivedSet.has(id) && doc.view.archived === 'default') continue
            if (summary.updatedAt > best) best = summary.updatedAt
          }
          if (best > 0) newest.set(workspace.workspaceId, best)
        }
        return workspaces
          .filter(workspace => newest.has(workspace.workspaceId))
          .sort((left, right) => newest.get(right.workspaceId) - newest.get(left.workspaceId))
          .slice(0, RECENT_LIMIT)
      }, [workspaces, list, archivedSet, doc.view.archived])

      const tabs = [
        ['all', t('tab.all')],
        ['recent', t('tab.recent')],
        ['categories', t('tab.categories')],
      ]

      /** Session rows of one workspace, with the category showing only summaries. */
      const renderSession = (row) => {
        const { summary, archived } = row
        const status = statuses.get(summary.id)
        /* A running session replaces its timestamp with a spinner, so live work is
           visible without a separate status column. The status map has no entry
           until a baseline or event establishes one, so fall back to the summary's
           own `running` flag the way the shipped tree does. */
        const running = !archived && (status?.running ?? summary.running) === true
        /* Resolve the child seats once. A seat with nothing in it must emit no
           wrapper at all, or every row carries three dead flex cells. */
        const seats = summary.blank
          ? { leading: null, trailing: null, action: null }
          : {
            leading: childSlot(CHILD_SLOTS.leading, { sessionId: summary.id }),
            trailing: childSlot(CHILD_SLOTS.trailing, { sessionId: summary.id }),
            action: childSlot(CHILD_SLOTS.action, {
              sessionId: summary.id,
              displayTitle: summary.displayTitle,
            }),
          }
        const classes = ['wsx-session']
        if (summary.id === currentSessionId) classes.push('wsx-session-selected')
        if (archived) classes.push('wsx-session-archived')
        /* The shipped menu has nothing to act on for a blank session. */
        const trigger = summary.blank
          ? { tabIndex: 0 }
          : getTriggerProps({
            kind: 'session',
            value: { sessionId: summary.id, displayTitle: summary.title ?? '' },
          }, {
            onKeyDown: (event) => {
              if (event.target !== event.currentTarget) return
              if (event.key !== 'Enter' && event.key !== ' ') return
              if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
              event.preventDefault()
              if (!archived) actions.openSession(summary.id)
            },
          })
        return h('div', {
          key: summary.id,
          className: classes.join(' '),
          role: 'treeitem',
          'aria-level': 3,
          'aria-disabled': archived ? 'true' : undefined,
          title: summary.displayTitle,
          onClick: () => {
            if (archived) {
              actions.notifyArchived()
              return
            }
            actions.openSession(summary.id)
          },
          ...trigger,
        },
        status?.pendingInteraction === undefined
          ? null
          : h('span', { className: 'wsx-session-flag' }, t('session.awaiting')),
        /* Leading decoration sits in its own cell, matching the shipped row's
           16px seat so an extension's icon does not shift our title. */
        archived || seats.leading === null
          ? null
          : h('span', { className: 'wsx-session-leading' }, seats.leading),
        h('span', { className: 'wsx-session-title' },
          summary.blank ? t('session.new') : summary.displayTitle),
        /* Trailing icons and extra row actions belong to extensions; the
           timestamp and our spinner stay ours. */
        seats.trailing === null
          ? null
          : h('span', { className: 'wsx-session-trailing' }, seats.trailing),
        running
          ? h('span', {
            className: 'wsx-spinner',
            role: 'status',
            'aria-label': t('session.running'),
            title: t('session.running'),
          })
          : h('span', { className: 'wsx-session-time' }, timeLabel(summary.updatedAt, now, t)),
        seats.action === null
          ? null
          : h('span', {
            className: 'wsx-session-actions',
            /* Clicks in the action strip act on the row's controls, never open
               the session, so an extension's button needs no propagation work. */
            onClick: (event) => { event.stopPropagation() },
          }, seats.action))
      }

      /**
       * One workspace row with its sessions. The workspace title is a tree item;
       * its sessions hang off an indent guide, so the three levels
       * (category, workspace, session) read as one hierarchy.
       * @param categoryId - owning box id, or null where a drop is meaningless.
       * @param workspace - the workspace, or undefined for the orphan bucket.
       * @param rows - session rows to render.
       * @param draggable - whether this row can be picked up.
       */
      const renderWorkspace = (categoryId, workspace, rows, draggable) => {
        const key = workspace === undefined ? OTHER_SESSIONS : workspace.workspaceId
        const limitKey = `${categoryId}:${key}`
        const limit = searching ? rows.length : (limits[limitKey] ?? BOX_LIMIT)
        const visible = rows.slice(0, limit)
        const hidden = rows.length - visible.length
        const folded = doc.collapsedWorkspaces.includes(key) && !searching
        const dragging = drag !== null && drag.kind === 'workspace'
          && drag.workspaceId === key
        const hint = dropHint !== null && dropHint.categoryId === categoryId
          && dropHint.beforeId === key
        const classes = ['wsx-workspace']
        if (dragging) classes.push('wsx-workspace-dragging')
        if (hint) classes.push('wsx-drop-before')
        const canStart = draggable && categoryId !== null
        return h('div', {
          key,
          className: classes.join(' '),
          'data-wsx-item': canStart ? key : undefined,
          role: 'treeitem',
          'aria-level': 2,
          'aria-expanded': !folded,
        },
        h('div', {
          className: canStart ? 'wsx-workspace-head wsx-grab' : 'wsx-workspace-head',
          onPointerDown: canStart
            ? event => beginPress(event, {
              kind: 'workspace',
              workspaceId: key,
              categoryId,
              disabled: event.target.closest('button') !== null,
            })
            : undefined,
          onContextMenu: workspace === undefined
            ? undefined
            : event => openMenuAt(event, workspaceMenuItems(workspace)),
        },
        /* The folder itself is the fold control: closed while folded, open while
           expanded, which is the affordance the row's own icon already implies. */
        h('button', {
          type: 'button',
          className: 'wsx-workspace-fold',
          'aria-expanded': !folded,
          'aria-label': folded ? t('menu.expandWorkspace') : t('menu.collapseWorkspace'),
          title: folded ? t('menu.expandWorkspace') : t('menu.collapseWorkspace'),
          onClick: (event) => {
            event.stopPropagation()
            actions.toggleWorkspaceCollapsed(key)
          },
        }, h('span', { className: 'wsx-workspace-icon' },
          folded ? ICON.folderClosed(15) : ICON.folderOpen(15))),
        h('span', { className: 'wsx-workspace-title' },
          workspace === undefined ? t('section.otherSessions') : workspaceTitle(workspace)),
        h('span', { className: 'wsx-workspace-count' }, String(rows.length)),
        workspace === undefined ? null : h('span', { className: 'wsx-workspace-actions' },
          h('button', {
            type: 'button',
            className: 'wsx-icon-btn',
            'aria-label': t('menu.newSession'),
            title: t('menu.newSession'),
            onClick: (event) => {
              event.stopPropagation()
              actions.startSession(workspace.workspaceId)
            },
          }, ICON.plus(13)),
          h('button', {
            type: 'button',
            className: 'wsx-icon-btn',
            'aria-label': t('menu.workspaceActions'),
            title: t('menu.workspaceActions'),
            onClick: event => openMenuAt(event, workspaceMenuItems(workspace)),
          }, ICON.dots(13)))),
        folded
          ? null
          : h('div', { className: 'wsx-guide' },
            visible.length === 0
              ? h('div', { className: 'wsx-cat-empty' },
                searching ? t('box.noMatches') : t('box.noSessions'))
              : visible.map(row => renderSession(row)),
            hidden > 0
              ? h('button', {
                type: 'button',
                className: 'wsx-more',
                onClick: () => setLimits(current => ({ ...current, [limitKey]: limit + BOX_LIMIT })),
              }, t('box.showMore', { n: hidden }))
              : null))
      }

      /* Rail state: the shell keeps 36px controls and asks for expansion. */
      if (!wide) {
        return h('div', { className: 'wsx-root wsx-rail' },
          h('button', {
            type: 'button',
            className: 'wsx-rail-btn',
            'aria-label': t('section.workspaces'),
            title: t('section.workspaces'),
            onClick: expandSidebar,
          }, ICON.folderClosed(18)),
          h('button', {
            type: 'button',
            className: 'wsx-rail-btn',
            'aria-label': t('actions.addWorkspace'),
            title: t('actions.addWorkspace'),
            onClick: () => { expandSidebar(); addWorkspace() },
          }, ICON.plus(16)))
      }

      const loadFailed = workspaceState.state === 'error'
      const notReady = workspaceState.phase !== 'ready'

      const tabStrip = h('div', { className: 'wsx-tabs', role: 'tablist', 'aria-label': t('section.workspaces') },
        tabs.map(([value, label]) => h('button', {
          key: value,
          type: 'button',
          role: 'tab',
          'aria-selected': doc.view.tab === value,
          className: doc.view.tab === value ? 'wsx-tab wsx-tab-on' : 'wsx-tab',
          onClick: () => { actions.setView({ tab: value }) },
        }, label)))

      const bodyContent = loadFailed
        ? h('div', { className: 'wsx-error', role: 'alert' },
          h('div', null, workspaceState.error?.message ?? t('section.loadFailed')),
          h('button', {
            type: 'button',
            className: 'wsx-link',
            onClick: () => { window.location.reload() },
          }, t('section.retry')))
        : notReady
          ? h('div', { className: 'wsx-loading' }, t('section.loading'))
          : doc.view.tab === 'recent'
            ? renderRecent()
            : doc.view.tab === 'all'
              ? renderAllSessions()
              : [
                ...orderedCategories.map(category => renderCategoryBox(category)),
                renderOtherSessions(),
                doc.categories.length === 0 && unassigned.length === 0 && workspaces.length === 0
                  ? h('div', { className: 'wsx-cat-empty' }, t('section.noWorkspaces'))
                  : null,
              ]

      const draggedLabel = drag === null
        ? ''
        : drag.kind === 'workspace'
          ? (byWorkspaceId.get(drag.workspaceId) === undefined
            ? (drag.workspaceId === OTHER_SESSIONS ? t('section.otherSessions') : '')
            : workspaceTitle(byWorkspaceId.get(drag.workspaceId)))
          : doc.categories.find(category => category.id === drag.categoryId)?.name ?? ''

      return h('div', { className: 'wsx-root' },
        h('div', { className: 'wsx-header' },
          h('span', { className: 'wsx-header-title' },
            h('span', { className: 'wsx-header-label' }, t('section.workspaces'))),
          h('span', { className: 'wsx-header-actions' },
            h('button', {
              type: 'button',
              className: 'wsx-icon-btn',
              'aria-label': t('actions.newCategory'),
              title: t('actions.newCategory'),
              onClick: () => askName(t('dialog.newCategory'), '', (name) => {
                actions.createCategory(name === '' ? t('dialog.newCategory') : name)
              }),
            }, ICON.plus(14)),
            h('button', {
              type: 'button',
              className: 'wsx-icon-btn',
              'aria-label': t('actions.addWorkspace'),
              title: t('actions.addWorkspace'),
              onClick: addWorkspace,
            }, ICON.folderClosed(16)),
            h('button', {
              type: 'button',
              className: 'wsx-icon-btn',
              'aria-label': t('actions.viewOptions'),
              title: t('actions.viewOptions'),
              onClick: event => openMenuAt(event, viewMenuItems()),
            }, ICON.sliders(14)))),
        h('div', { className: 'wsx-search' },
          h('span', { className: 'wsx-search-icon', 'aria-hidden': 'true' }, ICON.search(13)),
          h('input', {
            className: 'wsx-search-input',
            type: 'search',
            value: query,
            placeholder: t('search.placeholder'),
            'aria-label': t('search.placeholder'),
            onChange: event => setQuery(event.target.value),
            onKeyDown: (event) => {
              if (event.key !== 'Escape') return
              event.stopPropagation()
              setQuery('')
            },
          }),
          query === ''
            ? null
            : h('button', {
              type: 'button',
              className: 'wsx-icon-btn',
              'aria-label': t('search.clear'),
              onClick: () => setQuery(''),
            }, ICON.close(12))),
        saveFailure === null
          ? null
          : h('div', { className: 'wsx-notice', role: 'status' }, t('section.saveFailed')),
        error === null ? null : h('div', { className: 'wsx-error', role: 'alert' }, error),
        tabStrip,
        h('div', {
          className: 'wsx-body',
          role: 'tree',
          'aria-label': t('section.workspaces'),
        }, bodyContent),
        /* The catch-all bucket belongs at the foot, below the user's categories. */
        doc.view.tab === 'categories' ? renderUnassigned() : null,
        drag === null
          ? null
          : h(Overlay, null,
            h('div', {
              className: 'wsx-ghost',
              style: { left: drag.x + 12, top: drag.y + 12 },
            }, draggedLabel)),
        h(PopupMenu, { menu, onClose: closeMenu, onActivate: activateMenuItem }),
        h(Dialog, {
          request: dialog,
          busy,
          t,
          onCancel: closeDialog,
          onSettle: (value) => {
            const active = dialog
            closeDialog()
            active?.onCommit?.(value)
          },
        }))
    }

    /* ------------------------------------------------------------------ */
    /* Stylesheet                                                          */
    /* ------------------------------------------------------------------ */

    const STYLES = `
.wsx-root {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
}
/* The section header owns one fixed row height. Both the label and the three
   trailing controls are placed on the SAME box height and centred by flex, so
   none of them depends on a font baseline agreeing with an icon's bounds. */
.wsx-header {
  /* Geometry owner for the row. Changing --wsx-header-box moves the label box
     and all three icon squares together, so they cannot drift apart. */
  --wsx-header-h: 36px;
  --wsx-header-box: 24px;
  /* Optical corrections. A CJK glyph's ink sits low inside its em box, so the
     label carries its own upward nudge; the icon column keeps a separate hook.
     Both are sub-pixel and neither touches the row height. */
  --wsx-header-label-nudge: -2px;
  --wsx-header-icon-nudge: 0px;
  /* One inline edge shared with the search field, so the label starts exactly
     on the search box's left edge instead of a value of its own. */
  --wsx-inline-left: 0px;
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  height: var(--wsx-header-h);
  padding: 0 var(--wsx-inline-left);
}
/* The label takes the free space so the controls are pushed to the right edge. */
.wsx-header-title {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  height: var(--wsx-header-box);
  overflow: hidden;
  /* Primary ink so the section label reads as a title, not a hint. */
  color: var(--dsw-alias-label-primary);
  /* Sized to read at the same weight as the 16px glyphs beside it: a larger
     label made the row look bottom-heavy no matter how it was nudged. */
  font-size: 13px;
  font-weight: 500;
}
.wsx-header-label {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* 1.2 keeps the CJK glyphs clear of the box edges while staying centred. */
  line-height: 1.2;
  /* Visual-centre correction: a CJK glyph's ink mass sits below the middle of
     its em box, so lift the text to meet the icons' centres. */
  transform: translateY(var(--wsx-header-label-nudge));
}
/* The controls group is one flex row of fixed 24px boxes with one uniform gap. */
.wsx-header-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  height: var(--wsx-header-box);
  /* Optical compensation only: nudge the glyph column against the label's
     visual centre without touching the row height. */
  transform: translateY(var(--wsx-header-icon-nudge));
}
.wsx-icon-btn {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  /* Every icon owns a fixed square, so glyph size never changes the row. */
  width: var(--wsx-header-box);
  height: var(--wsx-header-box);
  padding: 0;
  color: var(--dsw-alias-label-secondary);
  background: transparent;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
}
/* Normalise each SVG inside its square: a block, centred, with no inline
   baseline gap under the glyph. */
.wsx-icon-btn > svg {
  display: block;
  flex: 0 0 auto;
}
.wsx-icon-btn:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.wsx-icon-btn:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.wsx-search {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  /* Shares the header's inline edge and right inset, so the two fields line up. */
  margin: 0 0 6px;
  padding: 0 8px;
  height: 30px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.wsx-search-icon { display: inline-flex; color: var(--dsw-alias-label-tertiary); }
.wsx-search-input {
  flex: 1 1 auto;
  min-width: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.wsx-search-input::placeholder { color: var(--dsw-alias-label-tertiary); }
.wsx-body {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 8px;
  min-height: 0;
  overflow-y: auto;
  padding: 0 0 12px;
}
.wsx-workspace > .wsx-cat-empty { padding-left: calc(var(--wsx-title-col) + 10px); }
.wsx-loading, .wsx-cat-empty {
  padding: 8px 10px;
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
}
.wsx-error {
  flex: 0 0 auto;
  margin: 0 0 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-error-primary);
  font-size: 12px;
  line-height: 1.5;
}
.wsx-notice {
  flex: 0 0 auto;
  margin: 0 0 6px;
  padding: 6px 8px;
  border-radius: var(--dsw-radius-sm);
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-state-warn-primary);
  font-size: 12px;
}
.wsx-link {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-state-business-primary);
  font: inherit;
  font-size: 12px;
  text-decoration: underline;
  cursor: pointer;
}
.wsx-cat {
  --wsx-accent: var(--dsw-alias-state-business-primary);
  flex: 0 0 auto;
  transition: background-color 120ms ease, opacity 120ms ease;
}
/* The tint belongs to the category's own row only: its workspaces and sessions
   hang below on the plain sidebar surface, so the block stays one breathing area
   instead of a filled card. */
.wsx-bar {
  position: relative;
  margin: 2px 0;
}
.wsx-cat-drop { box-shadow: inset 0 0 0 1.5px var(--wsx-accent); }
.wsx-cat-dragging { opacity: 0.5; }
/* Accent tones declare ONLY a variable. Setting the color property here would inherit into
   the category name, every workspace title, and every session title. */
.wsx-tone-ink { --wsx-accent: var(--dsw-alias-label-primary); --wsx-accent-strong: var(--dsw-alias-label-primary); }
.wsx-tone-red { --wsx-accent: var(--dsw-static-red-500); --wsx-accent-strong: var(--dsw-static-red-600); }
.wsx-tone-orange { --wsx-accent: #f97316; --wsx-accent-strong: #ea580c; }
.wsx-tone-amber { --wsx-accent: var(--dsw-static-amber-500); --wsx-accent-strong: var(--dsw-static-amber-600); }
.wsx-tone-green { --wsx-accent: var(--dsw-static-green-500); --wsx-accent-strong: #16a34a; }
.wsx-tone-blue { --wsx-accent: var(--dsw-static-blue-500); --wsx-accent-strong: var(--dsw-static-blue-600); }
.wsx-tone-violet { --wsx-accent: var(--dsw-static-violet-600); --wsx-accent-strong: var(--dsw-static-violet-600); }
.wsx-tone-pink { --wsx-accent: #ec4899; --wsx-accent-strong: #db2777; }
.wsx-tone-slate { --wsx-accent: var(--dsw-alias-state-idle-primary); --wsx-accent-strong: var(--dsw-alias-label-secondary); }
/* The tinted rounded rectangle belongs to the category's own row. Its workspaces
   and sessions sit on the plain sidebar surface below it. */
.wsx-cat-head {
  display: flex;
  align-items: center;
  gap: 7px;
  height: 36px;
  padding: 0 4px 0 10px;
  border-radius: var(--dsw-radius-lg);
  background: color-mix(in srgb, var(--wsx-accent) 13%, transparent);
  -webkit-user-select: none;
  user-select: none;
}
.wsx-cat-head:hover { background: color-mix(in srgb, var(--wsx-accent) 19%, transparent); }
/* The catch-all footer is not a user category: no accent tint. */
.wsx-bar-footer .wsx-cat-head { background: var(--dsw-alias-bg-layer-1); }
.wsx-bar-footer .wsx-cat-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-grab { cursor: grab; }
.wsx-grab:active { cursor: grabbing; }
/* The category glyph is the fold control: it is always visible and coloured. */
.wsx-cat-fold {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  background: transparent;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
}
.wsx-cat-fold:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-cat-fold:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.wsx-cat-glyph {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  /* The only element that takes the accent as ink. */
  color: var(--wsx-accent-strong, var(--wsx-accent));
}
.wsx-cat-name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  /* Explicit primary ink, so a tone can never tint the title. */
  color: var(--dsw-alias-label-primary);
  font-size: 14px;
  font-weight: 600;
}
.wsx-cat-badge {
  flex: 0 0 auto;
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-secondary);
  font-size: 11px;
  line-height: 18px;
  text-align: center;
}
.wsx-cat-pin { display: inline-flex; color: var(--wsx-accent); }
/* The add button stays out of the way until the row is hovered or focused, so a
   quiet sidebar keeps its count and only reveals the action on intent. It is
   always present for touch, which has no hover. */
.wsx-cat-add { display: none; }
.wsx-cat-head:hover .wsx-cat-add,
.wsx-cat-head:focus-within .wsx-cat-add { display: inline-flex; }
@media (hover: none) {
  .wsx-cat-add { display: inline-flex; }
}
.wsx-cat-body { display: flex; flex-direction: column; gap: 1px; padding: 1px 0 4px; }
.wsx-workspace {
  /* Single geometry owner. A workspace row is [pad][folder 16][gap][title]; its
     sessions sit inside the guide and start their title on the SAME column, so
     workspace titles and session titles share one left edge. */
  --wsx-guide-x: 18px;
  --wsx-ws-pad: 26px;
  --wsx-icon-w: 16px;
  --wsx-row-gap: 8px;
  --wsx-icon-col: var(--wsx-ws-pad);
  --wsx-title-col: calc(var(--wsx-ws-pad) + var(--wsx-icon-w) + var(--wsx-row-gap));
  padding: 0;
  border-radius: var(--dsw-radius-md);
}
.wsx-workspace-dragging { opacity: 0.45; }
.wsx-drop-before { box-shadow: inset 0 2px 0 0 var(--wsx-accent); }
.wsx-append-line {
  height: 2px;
  margin: 1px 0 1px var(--wsx-title-col);
  border-radius: 1px;
  background: var(--wsx-accent);
}
/* The indent guide is the visible thread from a workspace to its sessions. Its
   border lands on the guide column and its padding carries the text to the
   title column, so a session title lines up under the workspace title. */
.wsx-guide {
  display: flex;
  flex-direction: column;
  gap: 1px;
  margin-left: var(--wsx-guide-x);
  border-left: 1.5px solid var(--dsw-alias-border-l2);
  padding-left: calc(var(--wsx-title-col) - var(--wsx-guide-x) - 1.5px);
  margin-top: -2px;
  padding-bottom: 2px;
}
.wsx-guide-flat { margin-left: 8px; padding-left: 8px; border-left-color: transparent; }
.wsx-workspace-head {
  display: flex;
  align-items: center;
  gap: var(--wsx-row-gap);
  height: 30px;
  padding: 0 4px 0 var(--wsx-ws-pad);
  border-radius: var(--dsw-radius-sm);
  -webkit-user-select: none;
  user-select: none;
}
.wsx-workspace-head:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* The folder glyph is the fold control: closed while folded, open while shown. */
.wsx-workspace-fold {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--wsx-icon-w);
  height: 24px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  border-radius: var(--dsw-radius-xs);
  cursor: pointer;
}
.wsx-workspace-fold:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-interactive-bg-hover); }
.wsx-workspace-fold:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.wsx-workspace-icon {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  width: var(--wsx-icon-w);
}
.wsx-workspace-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
}
.wsx-workspace-count { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.wsx-workspace-actions { display: none; gap: 1px; align-items: center; }
.wsx-workspace-head:hover .wsx-workspace-actions { display: inline-flex; }
.wsx-workspace-head:hover .wsx-workspace-count { display: none; }
/* Touch has no hover, so the only non-drag way to file a workspace must stay visible. */
@media (hover: none) {
  .wsx-workspace-actions { display: inline-flex; }
  .wsx-workspace-count { display: none; }
}
.wsx-sessions { display: flex; flex-direction: column; gap: 1px; }
.wsx-session {
  display: flex;
  align-items: center;
  gap: var(--wsx-row-gap);
  height: 30px;
  /* No leading marker: the title starts on the workspace title's column, so the
     two read as one left-aligned stack inside the indent guide. */
  padding: 0 8px 0 0;
  border-radius: var(--dsw-radius-sm);
  cursor: pointer;
  outline: none;
  -webkit-user-select: none;
  user-select: none;
}
.wsx-session:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-session:focus-visible { box-shadow: inset 0 0 0 1px var(--dsw-alias-state-business-primary); }
.wsx-session-selected { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-session-archived { opacity: 0.55; cursor: default; }
.wsx-session-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  line-height: 20px;
}
.wsx-session-flag { flex: 0 0 auto; color: var(--dsw-alias-state-warn-primary); font-size: 11px; }
.wsx-session-time { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
/* Seats for extension entries. The row emits these wrappers only when an entry
   is actually seated, so a row with no extension looks exactly as before. */
.wsx-session-leading {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}
.wsx-session-trailing {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
}
.wsx-session-actions {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  gap: 2px;
}
/* A running session replaces its timestamp with a spinner. Without these rules
   the element has no size or colour and is invisible, which is exactly how it
   shipped broken once. */
.wsx-spinner {
  flex: 0 0 auto;
  box-sizing: border-box;
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, var(--dsw-alias-state-business-primary) 25%, transparent);
  border-top-color: var(--dsw-alias-state-business-primary);
  border-radius: 50%;
  animation: wsx-spin 720ms linear infinite;
}
@keyframes wsx-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}
/* Static but unmistakable for users who ask for less motion. */
@media (prefers-reduced-motion: reduce) {
  .wsx-spinner {
    animation: none;
    border-color: var(--dsw-alias-state-business-primary);
  }
}
.wsx-more {
  margin: 1px 0 2px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}
.wsx-more:hover { color: var(--dsw-alias-label-primary); }
/* Filter tabs: the three ways into the workspace list. */
.wsx-tabs {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
  margin: 0 0 6px;
  padding: 2px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1);
}
.wsx-tab {
  flex: 1 1 auto;
  height: 26px;
  padding: 0 6px;
  border: 0;
  border-radius: calc(var(--dsw-radius-md) - 2px);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.wsx-tab:hover { color: var(--dsw-alias-label-primary); }
/* The active tab is a tinted pill, not just bolder text, so the current view is
   unmistakable. The tint defaults to a light blue. */
.wsx-tab-on {
  background: color-mix(in srgb, var(--dsw-static-blue-500) 14%, transparent);
  color: var(--dsw-alias-label-primary);
  font-weight: 600;
  box-shadow: none;
}
.wsx-tab:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
/* The Recent tab lists whole workspaces. */
.wsx-recent { display: flex; flex-direction: column; gap: 4px; }
.wsx-rail { align-items: center; gap: 2px; padding-top: 6px; }
.wsx-rail-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
}
.wsx-rail-btn:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.wsx-glyph { pointer-events: none; }
.wsx-menu {
  position: fixed;
  z-index: 1200;
  min-width: 200px;
  max-width: 260px;
  overflow-y: auto;
  padding: 4px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-menu-surface-fill);
  backdrop-filter: blur(20px);
  box-shadow: 0 8px 28px rgb(0 0 0 / 16%), 0 0 0 0.5px var(--dsw-alias-border-l2);
}
.wsx-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  min-height: 34px;
  padding: 0 8px;
  border: 0;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}
.wsx-menu-item:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-menu-item:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: -2px; }
.wsx-menu-item:disabled { opacity: 0.45; cursor: default; }
.wsx-menu-danger { color: var(--dsw-alias-state-error-primary); }
.wsx-menu-icon { display: inline-flex; width: 12px; color: inherit; }
.wsx-menu-label { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-menu-check { display: inline-flex; color: var(--dsw-alias-state-business-primary); }
.wsx-menu-sep { height: 1px; margin: 4px 6px; background: var(--dsw-alias-border-l2); }
.wsx-scrim {
  position: fixed;
  inset: 0;
  z-index: 1300;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--dsw-alias-bg-mask-1);
}
.wsx-dialog {
  width: 340px;
  max-width: calc(100vw - 32px);
  padding: 16px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 16px 48px rgb(0 0 0 / 24%);
}
.wsx-dialog-title { margin-bottom: 10px; font-size: 14px; font-weight: 600; }
.wsx-dialog-body { margin-bottom: 14px; color: var(--dsw-alias-label-secondary); font-size: 13px; line-height: 1.5; }
.wsx-dialog-input {
  width: 100%;
  height: 32px;
  box-sizing: border-box;
  margin-bottom: 14px;
  padding: 0 8px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  outline: none;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
}
.wsx-dialog-input:focus { border-color: var(--dsw-alias-state-business-primary); }
.wsx-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; }
.wsx-dialog-wide { width: 400px; }
.wsx-appearance { margin-bottom: 14px; }
.wsx-appearance-label {
  margin: 0 0 8px;
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  font-weight: 500;
}
.wsx-appearance-label + .wsx-swatches { margin-bottom: 16px; }
.wsx-swatches { display: flex; flex-wrap: wrap; gap: 8px; }
.wsx-swatch {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
}
/* The tone classes declare a variable, not a colour, so these must read the
   variable explicitly. currentColor here would paint every swatch in the text ink. */
.wsx-swatch-fill {
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: var(--wsx-accent);
  box-shadow: inset 0 0 0 0.5px rgb(0 0 0 / 10%);
}
.wsx-swatch.wsx-swatch-on {
  box-shadow: 0 0 0 2px var(--dsw-alias-bg-overlay), 0 0 0 3.5px var(--wsx-accent);
}
.wsx-swatch:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 2px; }
.wsx-glyphgrid { display: grid; grid-template-columns: repeat(10, 1fr); gap: 4px; }
.wsx-glyphcell {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  height: 30px;
  padding: 0;
  border: 0.5px solid transparent;
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  /* Preview the draft accent, so the grid shows what the category will look like. */
  color: var(--wsx-accent-strong, var(--wsx-accent));
  cursor: pointer;
}
.wsx-glyphcell:hover { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-glyphcell.wsx-glyphcell-on {
  border-color: var(--wsx-accent);
  background: color-mix(in srgb, var(--wsx-accent) 14%, transparent);
}
.wsx-glyphcell:focus-visible { outline: 2px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.wsx-btn {
  height: 30px;
  padding: 0 12px;
  border: 0.5px solid var(--dsw-alias-border-l2);
  border-radius: var(--dsw-radius-sm);
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.wsx-btn:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.wsx-btn:disabled { opacity: 0.5; cursor: default; }
.wsx-btn-primary {
  border-color: transparent;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
.wsx-btn-primary:hover:not(:disabled) { background: var(--dsw-alias-brand-primary); filter: brightness(1.15); }
.wsx-btn-danger { border-color: var(--dsw-alias-state-error-primary); color: var(--dsw-alias-state-error-primary); }
.wsx-ghost {
  position: fixed;
  z-index: 1400;
  max-width: 220px;
  overflow: hidden;
  padding: 4px 10px;
  border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-overlay);
  box-shadow: 0 8px 28px rgb(0 0 0 / 22%);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
  pointer-events: none;
}
@media (prefers-reduced-motion: reduce) {
  .wsx-cat, .wsx-workspace-head, .wsx-workspace-fold { transition: none; }
}
`

    /* ------------------------------------------------------------------ */
    /* Dictionaries                                                        */
    /* ------------------------------------------------------------------ */

    const zh = {
      'section.workspaces': '\u5de5\u4f5c\u533a',
      'section.unassigned': '\u672a\u5206\u7c7b',
      'section.otherSessions': '\u5176\u4ed6\u4f1a\u8bdd',
      'section.noRecent': '\u8fd8\u6ca1\u6709\u6700\u8fd1\u4f7f\u7528\u7684\u5de5\u4f5c\u533a\u3002',
      'tab.all': '\u5168\u90e8',
      'tab.recent': '\u6700\u8fd1',
      'tab.categories': '\u5206\u7c7b',
      'section.loading': '\u6b63\u5728\u8f7d\u5165\u5de5\u4f5c\u533a\u2026',
      'section.loadFailed': '\u5de5\u4f5c\u533a\u5217\u8868\u52a0\u8f7d\u5931\u8d25\u3002',
      'section.retry': '\u91cd\u65b0\u52a0\u8f7d\u9875\u9762',
      'section.noWorkspaces': '\u8fd8\u6ca1\u6709\u5de5\u4f5c\u533a\u3002\u7528\u4e0a\u65b9\u7684\u6587\u4ef6\u5939\u6309\u94ae\u6dfb\u52a0\u4e00\u4e2a\u3002',
      'section.saveFailed': '\u5206\u7c7b\u6682\u65f6\u65e0\u6cd5\u4fdd\u5b58\uff0c\u6b63\u5728\u91cd\u8bd5\u3002\u4fee\u6539\u5148\u4fdd\u7559\u5728\u9875\u9762\u91cc\uff0c\u4f46\u5237\u65b0\u540e\u53ef\u80fd\u4e22\u5931\u3002',
      'search.placeholder': '\u641c\u7d22\u4f1a\u8bdd',
      'search.clear': '\u6e05\u9664\u641c\u7d22',
      'actions.newCategory': '\u65b0\u5efa\u5206\u7c7b',
      'actions.addWorkspace': '\u6dfb\u52a0\u5de5\u4f5c\u533a',
      'actions.viewOptions': '\u89c6\u56fe\u9009\u9879',
      'view.hideArchived': '\u9690\u85cf\u5df2\u5f52\u6863',
      'view.showArchived': '\u663e\u793a\u5df2\u5f52\u6863',
      'view.onlyArchived': '\u53ea\u770b\u5df2\u5f52\u6863',
      'box.emptyCategory': '\u957f\u6309\u5de5\u4f5c\u533a\u6807\u9898\u628a\u5b83\u62d6\u8fdb\u6765\uff0c\u6216\u7528\u5de5\u4f5c\u533a\u7684\u300c\u2026\u300d\u83dc\u5355\u9009\u300c\u79fb\u5230\u5206\u7c7b\u300d\u3002',
      'box.noSessions': '\u8fd8\u6ca1\u6709\u4f1a\u8bdd',
      'box.noMatches': '\u6ca1\u6709\u5339\u914d\u7684\u4f1a\u8bdd',
      'box.showMore': '\u663e\u793a\u66f4\u591a\uff08{n}\uff09',
      'box.createdButUnfiled': '\u5de5\u4f5c\u533a\u5df2\u521b\u5efa\uff0c\u4f46\u672a\u80fd\u81ea\u52a8\u5f52\u5165\u5206\u7c7b\uff0c\u8bf7\u624b\u52a8\u62d6\u5165\u3002',
      'session.new': '\u65b0\u4f1a\u8bdd',
      'session.awaiting': '\u5f85\u5904\u7406',
      'session.running': '\u6b63\u5728\u8fd0\u884c',
      'time.now': '\u521a\u521a',
      'time.minutes': '{n} \u5206\u949f',
      'time.hours': '{n} \u5c0f\u65f6',
      'time.days': '{n} \u5929',
      'time.months': '{n} \u4e2a\u6708',
      'color.ink': '\u58a8\u9ed1',
      'color.red': '\u7ea2\u8272',
      'color.orange': '\u6a59\u8272',
      'color.amber': '\u9ec4\u8272',
      'color.green': '\u7eff\u8272',
      'color.blue': '\u84dd\u8272',
      'color.violet': '\u7d2b\u8272',
      'color.pink': '\u7c89\u8272',
      'color.slate': '\u7070\u8272',
      'menu.renameCategory': '\u91cd\u547d\u540d\u5206\u7c7b',
      'menu.pinCategory': '\u7f6e\u9876\u5206\u7c7b',
      'menu.unpinCategory': '\u53d6\u6d88\u7f6e\u9876',
      'menu.collapseCategory': '\u6536\u8d77\u5206\u7c7b',
      'menu.collapseWorkspace': '\u6536\u8d77\u5de5\u4f5c\u533a',
      'menu.expandWorkspace': '\u5c55\u5f00\u5de5\u4f5c\u533a',
      'menu.expandCategory': '\u5c55\u5f00\u5206\u7c7b',
      'menu.deleteCategory': '\u5220\u9664\u5206\u7c7b',
      'menu.moveUp': '\u4e0a\u79fb\u5206\u7c7b',
      'menu.moveDown': '\u4e0b\u79fb\u5206\u7c7b',
      'menu.categoryActions': '\u5206\u7c7b\u64cd\u4f5c',
      'menu.addWorkspaceToCategory': '\u5728\u6b64\u5206\u7c7b\u65b0\u5efa\u5de5\u4f5c\u533a',
      'menu.workspaceActions': '\u5de5\u4f5c\u533a\u64cd\u4f5c',
      'menu.newSession': '\u65b0\u5efa\u4f1a\u8bdd',
      'menu.moveToCategory': '\u79fb\u5230\u5206\u7c7b',
      'menu.back': '\u53d6\u6d88',
      'menu.removeFromCategory': '\u79fb\u51fa\u5206\u7c7b',
      'menu.renameWorkspace': '\u91cd\u547d\u540d\u5de5\u4f5c\u533a',
      'menu.deleteWorkspace': '\u5220\u9664\u5de5\u4f5c\u533a',
      'dialog.newCategory': '\u65b0\u5efa\u5206\u7c7b',
      'dialog.appearance': '\u5206\u7c7b\u56fe\u6807\u4e0e\u989c\u8272',
      'dialog.icon': '\u56fe\u6807',
      'dialog.color': '\u989c\u8272',
      'dialog.iconName': '\u9009\u62e9\u56fe\u6807',
      'dialog.done': '\u5b8c\u6210',
      'menu.appearance': '\u56fe\u6807\u4e0e\u989c\u8272',
      'dialog.renameCategory': '\u91cd\u547d\u540d\u5206\u7c7b',
      'dialog.renameWorkspace': '\u91cd\u547d\u540d\u5de5\u4f5c\u533a',
      'dialog.deleteCategory': '\u5220\u9664\u5206\u7c7b',
      'dialog.deleteCategoryBody': '\u5220\u9664\u300c{name}\u300d\u540e\uff0c\u91cc\u9762\u7684\u5de5\u4f5c\u533a\u4f1a\u56de\u5230\u300c\u672a\u5206\u7c7b\u300d\uff0c\u4e0d\u4f1a\u5220\u9664\u4efb\u4f55\u4f1a\u8bdd\u3002',
      'dialog.deleteWorkspace': '\u5220\u9664\u5de5\u4f5c\u533a',
      'dialog.deleteWorkspaceBody': '\u5220\u9664\u300c{name}\u300d\u53ea\u4f1a\u79fb\u9664\u5de5\u4f5c\u533a\u767b\u8bb0\uff0c\u76ee\u5f55\u548c\u4f1a\u8bdd\u8bb0\u5f55\u90fd\u4f1a\u4fdd\u7559\u3002',
      'dialog.save': '\u4fdd\u5b58',
      'dialog.delete': '\u5220\u9664',
      'dialog.cancel': '\u53d6\u6d88',
    }

    const en = {
      'section.workspaces': 'Workspaces',
      'section.unassigned': 'Unassigned',
      'section.otherSessions': 'Other sessions',
      'section.noRecent': 'No recently used workspaces yet.',
      'tab.all': 'All',
      'tab.recent': 'Recent',
      'tab.categories': 'Categories',
      'section.loading': 'Loading workspaces…',
      'section.loadFailed': 'Could not load the workspace list.',
      'section.retry': 'Reload the page',
      'section.noWorkspaces': 'No workspaces yet. Use the folder button above to add one.',
      'section.saveFailed': 'Categories cannot be saved right now; retrying. Changes stay on this page but may be lost after a reload.',
      'search.placeholder': 'Search sessions',
      'search.clear': 'Clear search',
      'actions.newCategory': 'New category',
      'actions.addWorkspace': 'Add workspace',
      'actions.viewOptions': 'View options',
      'view.hideArchived': 'Hide archived',
      'view.showArchived': 'Show archived',
      'view.onlyArchived': 'Only archived',
      'box.emptyCategory': 'Press and hold a workspace title to drag it here, or choose Move to category from its … menu.',
      'box.noSessions': 'No sessions yet',
      'box.noMatches': 'No matching sessions',
      'box.showMore': 'Show more ({n})',
      'box.createdButUnfiled': 'Workspace created, but it could not be filed automatically. Drag it in.',
      'session.new': 'New session',
      'session.awaiting': 'Waiting',
      'session.running': 'Running',
      'time.now': 'now',
      'time.minutes': '{n}min',
      'time.hours': '{n}h',
      'time.days': '{n}d',
      'time.months': '{n}mo',
      'color.ink': 'Ink',
      'color.red': 'Red',
      'color.orange': 'Orange',
      'color.amber': 'Yellow',
      'color.green': 'Green',
      'color.blue': 'Blue',
      'color.violet': 'Violet',
      'color.pink': 'Pink',
      'color.slate': 'Grey',
      'menu.renameCategory': 'Rename category',
      'menu.pinCategory': 'Pin category',
      'menu.unpinCategory': 'Unpin category',
      'menu.collapseCategory': 'Collapse category',
      'menu.collapseWorkspace': 'Collapse workspace',
      'menu.expandWorkspace': 'Expand workspace',
      'menu.expandCategory': 'Expand category',
      'menu.deleteCategory': 'Delete category',
      'menu.moveUp': 'Move category up',
      'menu.moveDown': 'Move category down',
      'menu.categoryActions': 'Category actions',
      'menu.addWorkspaceToCategory': 'New workspace in this category',
      'menu.workspaceActions': 'Workspace actions',
      'menu.newSession': 'New session',
      'menu.moveToCategory': 'Move to category',
      'menu.back': 'Cancel',
      'menu.removeFromCategory': 'Remove from category',
      'menu.renameWorkspace': 'Rename workspace',
      'menu.deleteWorkspace': 'Delete workspace',
      'dialog.newCategory': 'New category',
      'dialog.appearance': 'Category icon and colour',
      'dialog.icon': 'Icon',
      'dialog.color': 'Colour',
      'dialog.iconName': 'Choose an icon',
      'dialog.done': 'Done',
      'menu.appearance': 'Icon and colour',
      'dialog.renameCategory': 'Rename category',
      'dialog.renameWorkspace': 'Rename workspace',
      'dialog.deleteCategory': 'Delete category',
      'dialog.deleteCategoryBody': 'Deleting "{name}" moves its workspaces back to Unassigned. No session is deleted.',
      'dialog.deleteWorkspace': 'Delete workspace',
      'dialog.deleteWorkspaceBody': 'Deleting "{name}" only removes the workspace registration; its directory and session logs are kept.',
      'dialog.save': 'Save',
      'dialog.delete': 'Delete',
      'dialog.cancel': 'Cancel',
    }

    /* ------------------------------------------------------------------ */
    /* Plugin                                                              */
    /* ------------------------------------------------------------------ */

    return {
      inject: ['slots', 'locale', 'sessions', 'workspaces', 'uiWorkspace'],
      apply(ctx) {
        const store = createDocStore()
        /** Save health as its own observable, so a failed write reaches the UI. */
        const saveStore = (() => {
          let current = null
          const listeners = new Set()
          return {
            get: () => current,
            subscribe(listener) {
              listeners.add(listener)
              return () => { listeners.delete(listener) }
            },
            set(next) {
              if (next === current) return
              current = next
              for (const listener of [...listeners]) listener()
            },
          }
        })()
        let saveTimer = 0
        let disposed = false
        let wrote = false

        /**
         * Write the document to the Host. A non-OK answer is a failed save, not
         * a silent no-op: the user is told, because categories that look saved
         * and are not would be lost on the next reload.
         * @returns the storage notice to show, or null once the write settles.
         */
        const flushSave = async () => {
          try {
            const response = await fetch(DOC_ROUTE, {
              method: 'PUT',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify(store.get()),
            })
            if (!response.ok) throw new Error(`save failed (HTTP ${response.status})`)
            saveStore.set(null)
            return null
          } catch (reason) {
            const notice = reason instanceof Error ? reason.message : String(reason)
            saveStore.set(notice)
            return notice
          }
        }

        const persist = () => {
          if (disposed) return
          window.clearTimeout(saveTimer)
          saveTimer = window.setTimeout(() => { void flushSave() }, SAVE_DEBOUNCE_MS)
        }

        const update = (mutate) => {
          const before = store.get()
          const next = normalize(mutate(before))
          /* A gesture that changes nothing must not rewrite the document. */
          if (JSON.stringify(next) === JSON.stringify(before)) return
          wrote = true
          store.replace(next)
          persist()
        }

        const uiWorkspace = ctx.get('uiWorkspace')
        const workspaces = ctx.get('workspaces')
        const contextMenus = ctx.get('contextMenus')

        const actions = {
          moveWorkspace: (workspaceId, categoryId, beforeId) => {
            update(doc => ({
              ...doc,
              categories: categoryId === UNASSIGNED
                ? withoutWorkspace(doc.categories, workspaceId)
                : assignWorkspace(doc.categories, workspaceId, categoryId, beforeId),
            }))
          },
          /** File one workspace into a category without naming an anchor row. */
          moveWorkspaceIntoCategory: (workspaceId, categoryId) => {
            update(doc => ({
              ...doc,
              categories: assignWorkspace(doc.categories, workspaceId, categoryId, undefined),
            }))
          },
          unassignWorkspace: (workspaceId) => {
            update(doc => ({ ...doc, categories: withoutWorkspace(doc.categories, workspaceId) }))
          },
          moveCategory: (categoryId, beforeCategoryId) => {
            update(doc => ({
              ...doc,
              categories: reorderCategory(doc.categories, categoryId, beforeCategoryId),
            }))
          },
          createCategory: (name) => {
            update(doc => ({
              ...doc,
              categories: [...doc.categories, {
                id: mintCategoryId(doc.categories),
                name,
                color: 'ink',
                icon: DEFAULT_GLYPH,
                pinned: false,
                collapsed: false,
                workspaceIds: [],
              }],
            }))
          },
          renameCategory: (categoryId, name) => {
            update(doc => ({
              ...doc,
              categories: doc.categories.map(category =>
                (category.id === categoryId ? { ...category, name } : category)),
            }))
          },
          setCategoryColor: (categoryId, color) => {
            update(doc => ({
              ...doc,
              categories: doc.categories.map(category =>
                (category.id === categoryId ? { ...category, color } : category)),
            }))
          },
          setCategoryIcon: (categoryId, icon) => {
            update(doc => ({
              ...doc,
              categories: doc.categories.map(category =>
                (category.id === categoryId ? { ...category, icon } : category)),
            }))
          },
          toggleCategoryPinned: (categoryId) => {
            update(doc => ({
              ...doc,
              categories: doc.categories.map(category =>
                (category.id === categoryId ? { ...category, pinned: !category.pinned } : category)),
            }))
          },
          toggleCategoryCollapsed: (categoryId) => {
            update(doc => ({
              ...doc,
              categories: doc.categories.map(category =>
                (category.id === categoryId ? { ...category, collapsed: !category.collapsed } : category)),
            }))
          },
          toggleUnassignedCollapsed: () => {
            update(doc => ({ ...doc, unassignedCollapsed: !doc.unassignedCollapsed }))
          },
          toggleWorkspaceCollapsed: (workspaceId) => {
            update(doc => ({
              ...doc,
              collapsedWorkspaces: doc.collapsedWorkspaces.includes(workspaceId)
                ? doc.collapsedWorkspaces.filter(id => id !== workspaceId)
                : [...doc.collapsedWorkspaces, workspaceId],
            }))
          },
          deleteCategory: (categoryId) => {
            update(doc => ({
              ...doc,
              categories: doc.categories.filter(category => category.id !== categoryId),
            }))
          },
          setView: (patch) => {
            update(doc => ({ ...doc, view: { ...doc.view, ...patch } }))
          },
          openSession: (sessionId) => { uiWorkspace?.openSession(sessionId) },
          startSession: (workspaceId) => { uiWorkspace?.startSession(workspaceId) },
          notifyArchived: () => {
            contextMenus?.notify('That session is archived. Unarchive it from its menu to open it.')
          },
          pickDirectory: async () => (uiWorkspace === undefined ? null : uiWorkspace.pickDirectory()),
          /**
           * Create a workspace and hand back its id.
           * @param path - directory to open as a workspace.
           * @returns the new workspace's id, or null when the platform declined.
           */
          createWorkspace: async (path) => {
            if (workspaces === undefined) return null
            const created = await workspaces.create({ path })
            /* The Client service resolves to the workspace view; older builds
               may return nothing, in which case the caller falls back to a
               title match. */
            const id = created?.workspaceId ?? created?.id
            return typeof id === 'string' && id !== '' ? id : null
          },
          renameWorkspace: async (workspaceId, title) => {
            if (workspaces !== undefined) await workspaces.rename(workspaceId, title)
          },
          deleteWorkspace: async (workspaceId) => {
            if (workspaces !== undefined) await workspaces.delete(workspaceId)
            update(doc => ({ ...doc, categories: withoutWorkspace(doc.categories, workspaceId) }))
          },
        }

        ctx.effect(() => {
          const element = document.createElement('style')
          element.setAttribute('data-dsh-workspace-categories', '')
          element.textContent = STYLES
          document.head.append(element)
          return () => { element.remove() }
        }, 'workspace-categories: stylesheet')

        ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'workspace-categories: dictionaries')

        /* The Host document is loaded once per activation. A local edit made
           before the read settles wins, so a slow read cannot undo it. */
        void fetch(DOC_ROUTE, { cache: 'no-store' })
          .then(response => (response.ok ? response.json() : undefined))
          .then((value) => {
            if (disposed || wrote || value === undefined) return
            store.replace(normalize(value))
          })
          .catch(() => {})

        /* A save that failed retries on its own, and the notice clears once a
           write succeeds. */
        ctx.effect(() => {
          const id = window.setInterval(() => {
            if (saveStore.get() === null) return
            void flushSave()
          }, 5000)
          return () => {
            window.clearInterval(id)
            disposed = true
            window.clearTimeout(saveTimer)
          }
        }, 'workspace-categories: save retry')

        ctx.slots.inject('sidebar.workspaces', () => ctx.slots.register({
          name: 'sidebar.workspaces',
          id: 'workspace-categories',
          /*
           * Explicit and lower than the shipped browser's implicit 0. The live
           * slot ledger reads this value back verbatim, which proves it is applied
           * here rather than overwritten — dropping it once lost the slot
           * election and the built-in browser took over.
           */
          priority: SHADOW_PRIORITY,
          locale: NS,
          inject: () => ({ actions, docStore: store, saveStore }),
        }, WorkspaceSkin))
      },
    }
  },
})

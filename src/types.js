// Shared JSDoc types (no runtime code). Reference as: /** @type {import('../types.js').Route[]} */

/**
 * A page. Feature modules export `routes: Route[]` from their index.js; src/app.js mounts them.
 * @typedef {object} Route
 * @property {string} path   'workout', 'workout/session/:id' — no leading '#/' or '/'. ':name' = param.
 * @property {string} [title] document title
 * @property {string} [tab]  tab to highlight ('diary'|'workout'|'trends'|'settings'); default = first path segment
 * @property {(container: HTMLElement, params: Record<string, string>, ctx: RouteContext)
 *            => void | Cleanup | Promise<void | Cleanup>} mount
 */

/**
 * @typedef {object} RouteContext
 * @property {string} path  matched path, e.g. 'workout/session/abc'
 * @property {Record<string, string>} query  from '#/path?a=1&b=2'
 */

/** Called by the router before the next view mounts. Stop cameras, timers, listeners here.
 * @typedef {() => void} Cleanup */

export {};

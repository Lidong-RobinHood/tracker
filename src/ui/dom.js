// Tiny element builder. el(tag, props?, ...children)

const PROPS = new Set(['value', 'checked', 'selected', 'disabled', 'hidden', 'readOnly', 'htmlFor', 'textContent']);

/** Primary buttons whose async click handler is still running. */
const running = new WeakSet();

/**
 * Click handler wrapper: a primary button (`btn-primary`) ignores further clicks while the promise
 * returned by its handler is pending, so a quick double tap cannot save twice.
 */
function guardClick(node, fn) {
  return function onClick(e) {
    const primary = node.classList.contains('btn-primary');
    if (primary && running.has(node)) { e.preventDefault(); e.stopImmediatePropagation(); return undefined; }
    const r = fn.call(this, e);
    if (primary && r && typeof r.then === 'function') {
      running.add(node);
      r.then(() => running.delete(node), (err) => { running.delete(node); throw err; });
    }
    return r;
  };
}

/**
 * Create an element.
 *  - props.class: string or array (falsy entries skipped)
 *  - props.style: string or object ({ minWidth: '4rem' })
 *  - props.dataset: object -> data-* attributes
 *  - props.onClick / onInput / on<Anything>: function -> addEventListener('click', ...); a `btn-primary`
 *    ignores clicks while the promise its onClick returned is pending
 *  - value, checked, selected, disabled, hidden, readOnly, htmlFor, textContent: set as properties
 *  - anything else: setAttribute (true -> '', false/null/undefined -> skipped)
 * Children: strings, numbers, Nodes, arrays (flattened); null/undefined/false are skipped.
 * The props argument may be omitted: el('p', 'text') or el('div', [a, b]).
 * @returns {HTMLElement}
 */
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  if (props == null || typeof props !== 'object' || Array.isArray(props) || props instanceof Node) {
    children.unshift(props);
    props = {};
  }
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class' || k === 'className') {
      node.className = Array.isArray(v) ? v.filter(Boolean).join(' ') : v;
    } else if (k === 'style') {
      if (typeof v === 'string') node.style.cssText = v;
      else Object.assign(node.style, v);
    } else if (k === 'dataset') {
      Object.assign(node.dataset, v);
    } else if (/^on[A-Z]/.test(k) && typeof v === 'function') {
      const type = k.slice(2).toLowerCase();
      node.addEventListener(type, type === 'click' ? guardClick(node, v) : v);
    } else if (PROPS.has(k)) {
      node[k] = v;
    } else {
      node.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(node, children);
  return node;
}

/** Append children (same rules as el()). @returns {Node} parent */
export function append(parent, ...children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    parent.append(c instanceof Node ? c : String(c));
  }
  return parent;
}

/** Remove all children. @returns {Node} */
export function clear(node) {
  node.replaceChildren();
  return node;
}

/** Remove all children, then append. */
export function replaceChildren(node, ...children) {
  clear(node);
  return append(node, children);
}

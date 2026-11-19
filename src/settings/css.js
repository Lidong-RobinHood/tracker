// settings.css, loaded once (also used by the goal control inside the first-run setup).
import { el } from '../ui/index.js';

export function ensureCss() {
  if (document.querySelector('link[data-settings-css]')) return;
  document.head.append(el('link', { rel: 'stylesheet', href: new URL('./settings.css', import.meta.url).href, 'data-settings-css': '' }));
}

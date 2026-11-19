// First-run setup, help, update check and backup reminder. Routes: welcome, help.
// app.js calls startAppServices() after the first render (notice strip above the view).
import { mountWelcome } from './welcome.js';
import { mountHelp } from './help.js';

export { startAppServices } from './shell.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'welcome', title: 'Setup', tab: 'settings', mount: mountWelcome },
  { path: 'help', title: 'Help', tab: 'settings', mount: mountHelp },
];

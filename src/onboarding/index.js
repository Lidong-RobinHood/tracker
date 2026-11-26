// First-run setup, help, update check and backup reminder. Routes: welcome, help.
// app.js calls startAppServices() after the first render (notice strip above the view).
import { mountWelcome } from './welcome.js';
import { mountHelp } from './help.js';

export { startAppServices } from './shell.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'welcome', titleKey: 'onboarding.welcome.title', tab: 'settings', mount: mountWelcome },
  { path: 'help', titleKey: 'onboarding.help.title', tab: 'settings', mount: mountHelp },
];

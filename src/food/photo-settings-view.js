// Route food/photo-settings: provider choice, then that provider's key (localStorage only), model and test.
import { el, pageHeader, toast, confirmDialog, field, replaceChildren } from '../ui/index.js';
import { maskKey } from '../core/meal-photo.js';
import { PHOTO_PROVIDERS, PROVIDER_IDS, getAdapter } from '../core/photo-providers.js';
import {
  getProvider, setProvider, getApiKey, setApiKey, deleteApiKey, getModel, setModel,
  getBaseUrl, setBaseUrl, getUseSchema, setUseSchema,
} from './photo-key.js';
import { testApiKey, loadModels } from './photo-provider.js';
import { ensureCss } from './widgets.js';

export function mountPhotoSettings(container, params, ctx) {
  ensureCss();
  let ctrl = null; // AbortController of a running test / model load
  const abort = () => { if (ctrl) { ctrl.abort(); ctrl = null; } };
  container.append(pageHeader({ title: 'Meal photos', subtitle: 'AI analysis with your own API key', back: ctx.query.from === 'add' ? true : 'settings' }));

  // ------------------------------------------------------------ provider picker
  const providerList = el('div', { class: 'list', role: 'radiogroup', 'aria-label': 'Provider' },
    PROVIDER_IDS.map((id) => {
      const a = PHOTO_PROVIDERS[id];
      const rid = `pp-${id}`;
      const radio = el('input', { type: 'radio', name: 'photo-provider', id: rid, value: id, checked: id === getProvider(),
        onChange: () => { setProvider(id); abort(); renderProvider(); toast(`Provider: ${a.label}`); } });
      return el('label', { class: 'list-item model-row', htmlFor: rid },
        radio,
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, a.label),
          el('div', { class: 'li-sub' }, providerSub(id))));
    }));
  const providerSection = el('section', { class: 'card stack', 'aria-label': 'Provider' },
    el('h2', { class: 'section-title' }, 'Provider'),
    providerList,
    el('p', { class: 'small muted' }, 'Each provider has its own key and model. Only the selected provider is used for “Analyse”.'));

  function providerSub(id) {
    const parts = [];
    if (getApiKey(id)) parts.push(`key ${maskKey(getApiKey(id))}`); else parts.push('no key');
    if (getModel(id)) parts.push(getModel(id));
    return parts.join(' · ');
  }
  function refreshProviderSubs() {
    for (const id of PROVIDER_IDS) {
      const sub = providerList.querySelector(`#pp-${id}`)?.closest('label')?.querySelector('.li-sub');
      if (sub) sub.textContent = providerSub(id);
    }
  }

  const providerBody = el('div', { class: 'stack' });

  // ------------------------------------------------------------ one provider
  function renderProvider() {
    const id = getProvider();
    const a = getAdapter(id);
    const sections = [];
    if (a.needsBaseUrl) sections.push(baseUrlSection());
    sections.push(keySection(id, a), modelSection(id, a), notesSection(a));
    replaceChildren(providerBody, ...sections);
    refreshProviderSubs();
  }

  // -- custom base URL
  function baseUrlSection() {
    const input = el('input', { class: 'input', type: 'text', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: 'https://openrouter.ai/api/v1', 'aria-label': 'Base URL', name: 'photo-base-url', value: getBaseUrl() });
    const msg = el('p', { class: 'small field-error', role: 'alert' });
    const save = () => {
      const r = setBaseUrl(input.value);
      if (!r.ok) { msg.textContent = r.error; input.setAttribute('aria-invalid', 'true'); return; }
      input.removeAttribute('aria-invalid');
      input.value = r.url;
      msg.textContent = '';
      toast(`Base URL saved: ${r.url}`, { type: 'success' });
    };
    return el('section', { class: 'card stack', 'aria-label': 'Service' },
      el('h2', { class: 'section-title' }, 'Service'),
      el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        field('Base URL', input, { hint: 'The OpenAI-compatible API base of the service, usually ending in /v1. https only; never put the key in the URL.' }),
        msg,
        el('button', { type: 'submit', class: 'btn' }, 'Save base URL')));
  }

  // -- key
  function keySection(id, a) {
    const box = el('div', { class: 'stack' });
    const testMsg = el('p', { class: 'small', role: 'status' });

    function render() {
      const key = getApiKey(id);
      testMsg.textContent = '';
      if (key) {
        replaceChildren(box,
          el('div', { class: 'row-between' },
            el('div', null, el('div', { class: 'field-label' }, `${a.name} API key`), el('div', { class: 'num key-mask' }, maskKey(key))),
            el('span', { class: 'badge' }, 'Saved on this device')),
          el('div', { class: 'row photo-key-actions' },
            el('button', { type: 'button', class: 'btn photo-test-key', onClick: test }, 'Test key'),
            el('button', { type: 'button', class: 'btn btn-ghost', onClick: replace }, 'Replace'),
            el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: remove }, 'Delete key')),
          testMsg);
      } else {
        replaceChildren(box, form());
      }
      refreshProviderSubs();
    }

    function form() {
      const input = el('input', {
        class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        placeholder: a.keyPlaceholder, 'aria-label': `${a.name} API key`, name: `photo-api-key-${id}`,
      });
      const msg = el('p', { class: 'small field-error', role: 'alert' });
      const save = () => {
        const v = input.value.trim();
        if (!v) { msg.textContent = 'Paste your API key first.'; input.focus(); return; }
        if (/\s/.test(v)) { msg.textContent = 'The key must not contain spaces or line breaks.'; return; }
        if (!setApiKey(id, v)) { msg.textContent = 'This browser does not allow storing the key (private mode or blocked storage).'; return; }
        input.value = '';
        const looksOk = a.keyLooksValid(v);
        toast(looksOk ? 'Key saved on this device' : `Key saved – ${a.keyFormatNote}; use “Test key”.`, { type: looksOk ? 'success' : 'info' });
        render();
      };
      return el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        field(`${a.name} API key`, input, { hint: `${a.keyHelp} It is stored only in this browser.` }),
        msg,
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save key'));
    }

    async function test() {
      abort();
      const c = ctrl = new AbortController();
      testMsg.className = 'small muted';
      testMsg.textContent = 'Testing…';
      const model = getModel(id);
      const r = await testApiKey({ provider: id, apiKey: getApiKey(id), model, baseUrl: getBaseUrl(), signal: c.signal });
      if (ctrl !== c) return;
      ctrl = null;
      testMsg.className = `small ${r.ok ? 'text-success' : 'text-danger'}`;
      testMsg.textContent = r.ok
        ? (r.checkedModel ? `The key works and can use ${model}.` : `The key works.${model ? ` (The model ${model} is checked on the first analysis.)` : ''}`)
        : `${r.message}${r.detail ? ` (${r.detail})` : ''}`;
    }

    function replace() { replaceChildren(box, form()); requestAnimationFrame(() => { const i = box.querySelector('input'); if (i) i.focus(); }); }

    async function remove() {
      const ok = await confirmDialog({ title: `Delete ${a.name} key?`, message: `The key is removed from this browser. To revoke it completely, also delete it in your ${a.name} account.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      deleteApiKey(id);
      toast('API key deleted');
      render();
    }

    render();
    return el('section', { class: 'card stack', 'aria-label': 'API key' }, el('h2', { class: 'section-title' }, 'API key'), box);
  }

  // -- model
  function modelSection(id, a) {
    const current = el('p', { class: 'small' });
    const loadMsg = el('p', { class: 'small', role: 'status' });
    const picker = el('select', { class: 'select photo-model-picker', 'aria-label': 'Models from the provider', hidden: true,
      onChange: () => { if (picker.value) use(picker.value); } });
    const free = el('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: a.defaultModel || 'e.g. provider/model-name', 'aria-label': 'Model id', name: `photo-model-${id}` });
    const freeMsg = el('p', { class: 'small field-error', role: 'alert' });

    function showCurrent() {
      const m = getModel(id);
      replaceChildren(current, 'Active model: ', m ? el('code', { class: 'model-id' }, m) : el('span', { class: 'text-warning' }, 'none – choose or type one'));
      for (const r of suggestions.querySelectorAll('input[type=radio]')) r.checked = r.value === m;
      refreshProviderSubs();
    }
    function use(m) {
      if (!setModel(id, m)) { freeMsg.textContent = 'That is not a valid model id (letters, digits and . _ : / @ + - only).'; return; }
      freeMsg.textContent = '';
      showCurrent();
      toast(`Model: ${getModel(id)}`);
    }

    const suggestions = el('div', { class: 'list', role: 'radiogroup', 'aria-label': 'Suggested models' },
      a.suggested.map((s) => {
        const rid = `pm-${id}-${s.id}`;
        return el('label', { class: 'list-item model-row', htmlFor: rid },
          el('input', { type: 'radio', name: `photo-model-${id}-s`, id: rid, value: s.id, onChange: () => use(s.id) }),
          el('div', { class: 'li-main' },
            el('div', { class: 'li-title' }, s.label, s.id === a.defaultModel ? el('span', { class: 'badge model-default' }, 'default') : null),
            el('div', { class: 'li-sub' }, el('code', { class: 'model-id' }, s.id), ` · ${s.note}`)));
      }));

    async function load() {
      const key = getApiKey(id);
      if (!key) { loadMsg.className = 'small text-danger'; loadMsg.textContent = 'Save a key first.'; return; }
      abort();
      const c = ctrl = new AbortController();
      loadMsg.className = 'small muted';
      loadMsg.textContent = 'Loading models…';
      const r = await loadModels({ provider: id, apiKey: key, baseUrl: getBaseUrl(), signal: c.signal });
      if (ctrl !== c) return;
      ctrl = null;
      if (!r.ok) { loadMsg.className = 'small text-danger'; loadMsg.textContent = `${r.message}${r.detail ? ` (${r.detail})` : ''}`; return; }
      const m = getModel(id);
      replaceChildren(picker,
        el('option', { value: '' }, r.models.length ? `Choose one of ${r.models.length} models…` : 'No models listed'),
        r.models.map((x) => el('option', { value: x.id, selected: x.id === m }, x.label === x.id ? x.id : `${x.label} (${x.id})`)));
      picker.hidden = false;
      loadMsg.className = 'small muted';
      loadMsg.textContent = id === 'anthropic' ? 'Showing models that accept images.'
        : id === 'gemini' ? 'Showing models that support generateContent. The list does not say which accept images; Gemini 4 models do.'
          : 'This list is not filtered to image models unless the service says which accept images. Pick one that accepts images.';
    }

    const schemaToggle = id === 'custom' ? el('label', { class: 'row check-row small' },
      el('input', { type: 'checkbox', checked: getUseSchema(), onChange: (e) => { setUseSchema(e.target.checked); toast(e.target.checked ? 'JSON schema will be sent' : 'JSON schema off (sent in the instructions instead)'); } }),
      el('span', null, 'Send JSON schema (structured outputs) – only if the service supports it')) : null;

    const section = el('section', { class: 'card stack', 'aria-label': 'Model' },
      el('h2', { class: 'section-title' }, 'Model'),
      current,
      a.suggested.length ? suggestions : null,
      el('div', { class: 'row photo-key-actions' }, el('button', { type: 'button', class: 'btn photo-load-models', onClick: load }, 'Load models')),
      loadMsg,
      picker,
      el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); use(free.value.trim()); if (!freeMsg.textContent) free.value = ''; } },
        field('Model id', free, { hint: 'Any model id of this provider that accepts images.' }),
        freeMsg,
        el('button', { type: 'submit', class: 'btn' }, 'Use this model')),
      schemaToggle,
      el('p', { class: 'small muted' }, 'More capable models usually estimate better but cost more per photo and take longer.',
        a.pricingUrl ? [' Current prices: ', el('a', { href: a.pricingUrl, target: '_blank', rel: 'noopener noreferrer' }, `${a.name} pricing`), '.'] : ' See the service’s own pricing page.'));
    showCurrent();
    return section;
  }

  // -- notes
  function notesSection(a) {
    return el('section', { class: 'card stack photo-note', 'aria-label': 'Privacy and cost' },
      el('h2', { class: 'section-title' }, 'Privacy and cost'),
      el('ul', { class: 'plain-list small' },
        a.notes.map((n) => el('li', null, n)),
        el('li', null, 'When you tap “Analyse”, the photo (downscaled to 1568 px) and your hint are sent directly from this browser to the provider. Nothing else from your diary is sent. “Test key” and “Load models” do not use tokens.'),
        el('li', null, 'Keys are stored only in this browser’s local storage, one per provider. They are not part of the backup/export file and are only sent to their own provider.'),
        el('li', null, 'Anyone who can use this browser profile can use the keys. Delete them here if you share the device, and set a spend limit with the provider.')));
  }

  container.append(providerSection, providerBody);
  renderProvider();
  return () => abort();
}


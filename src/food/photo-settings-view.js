// Route food/photo-settings: provider choice, then that provider's key (localStorage only), model and test.
import { el, pageHeader, toast, confirmDialog, field, replaceChildren, sectionHeader, icon } from '../ui/index.js';
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
  container.append(pageHeader({ title: 'Meal photos', subtitle: 'Your own API key', back: ctx.query.from === 'add' ? true : 'settings' }));

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
  const providerSection = el('section', { class: 'section', 'aria-label': 'Provider' },
    sectionHeader('Provider'),
    el('div', { class: 'card card-flush' }, providerList));

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
    const msg = el('p', { class: 'field-error', role: 'alert' });
    const save = () => {
      const r = setBaseUrl(input.value);
      if (!r.ok) { msg.textContent = r.error; input.setAttribute('aria-invalid', 'true'); return; }
      input.removeAttribute('aria-invalid');
      input.value = r.url;
      msg.textContent = '';
      toast(`Base URL saved: ${r.url}`, { type: 'success' });
    };
    return el('section', { class: 'section', 'aria-label': 'Service' },
      sectionHeader('Service'),
      el('form', { class: 'card stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        field('Base URL', input, { hint: 'Usually ends in /v1. Never put the key here.' }),
        msg,
        el('button', { type: 'submit', class: 'btn' }, 'Save base URL')));
  }

  // -- key
  function keySection(id, a) {
    const box = el('div', { class: 'stack' });
    const testMsg = el('p', { class: 't-sub', role: 'status' });

    function render() {
      const key = getApiKey(id);
      testMsg.textContent = '';
      if (key) {
        replaceChildren(box,
          el('div', { class: 'row-between' },
            el('div', { class: 'key-row' }, icon('key-round', { class: 'li-lead' }),
              el('div', null, el('div', { class: 'field-label' }, `${a.name} API key`), el('div', { class: 'num key-mask' }, maskKey(key)))),
            el('span', { class: 'badge' }, 'Saved on this device')),
          el('div', { class: 'row photo-key-actions' },
            el('button', { type: 'button', class: 'btn photo-test-key', onClick: test }, icon('check'), 'Test key'),
            el('button', { type: 'button', class: 'btn btn-ghost', onClick: replace }, 'Replace'),
            el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: remove }, icon('trash-2'), 'Delete key')),
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
      const msg = el('p', { class: 'field-error', role: 'alert' });
      const save = () => {
        const v = input.value.trim();
        if (!v) { msg.textContent = 'Paste your API key first.'; input.focus(); return; }
        if (/\s/.test(v)) { msg.textContent = 'The key must not contain spaces or line breaks.'; return; }
        if (!setApiKey(id, v)) { msg.textContent = 'This browser blocks storage. Private mode?'; return; }
        input.value = '';
        const looksOk = a.keyLooksValid(v);
        toast(looksOk ? 'Key saved on this device' : `Key saved – ${a.keyFormatNote}; use “Test key”.`, { type: looksOk ? 'success' : 'info' });
        render();
      };
      return el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        field(`${a.name} API key`, input, { hint: `${a.keyHelp} Stored only in this browser.` }),
        msg,
        el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save key'));
    }

    async function test() {
      abort();
      const c = ctrl = new AbortController();
      testMsg.className = 't-sub muted';
      testMsg.textContent = 'Testing…';
      const model = getModel(id);
      const r = await testApiKey({ provider: id, apiKey: getApiKey(id), model, baseUrl: getBaseUrl(), signal: c.signal });
      if (ctrl !== c) return;
      ctrl = null;
      testMsg.className = `t-sub ${r.ok ? 'text-success' : 'text-danger'}`;
      testMsg.textContent = r.ok
        ? (r.checkedModel ? `The key works and can use ${model}.` : `Key works.${model ? ' Model checked on first analysis.' : ''}`)
        : `${r.message}${r.detail ? ` (${r.detail})` : ''}`;
    }

    function replace() { replaceChildren(box, form()); requestAnimationFrame(() => { const i = box.querySelector('input'); if (i) i.focus(); }); }

    async function remove() {
      const ok = await confirmDialog({ title: `Delete ${a.name} key?`, message: `Removed from this browser. To revoke it, delete it in your ${a.name} account too.`, confirmLabel: 'Delete', danger: true });
      if (!ok) return;
      deleteApiKey(id);
      toast('API key deleted');
      render();
    }

    render();
    return el('section', { class: 'section', 'aria-label': 'API key' }, sectionHeader('API key'), el('div', { class: 'card' }, box));
  }

  // -- model
  function modelSection(id, a) {
    const current = el('p', { class: 't-sub' });
    const loadMsg = el('p', { class: 't-sub', role: 'status' });
    const picker = el('select', { class: 'select photo-model-picker', 'aria-label': 'Models from the provider', hidden: true,
      onChange: () => { if (picker.value) use(picker.value); } });
    const free = el('input', { class: 'input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: a.defaultModel || 'e.g. provider/model-name', 'aria-label': 'Model id', name: `photo-model-${id}` });
    const freeMsg = el('p', { class: 'field-error', role: 'alert' });

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
            el('div', { class: 'li-title' }, s.label, s.id === a.defaultModel ? el('span', { class: 'badge badge-dropset model-default' }, 'default') : null),
            el('div', { class: 'li-sub' }, el('code', { class: 'model-id' }, s.id), ` · ${s.note}`)));
      }));

    async function load() {
      const key = getApiKey(id);
      if (!key) { loadMsg.className = 't-sub text-danger'; loadMsg.textContent = 'Save a key first.'; return; }
      abort();
      const c = ctrl = new AbortController();
      loadMsg.className = 't-sub muted';
      loadMsg.textContent = 'Loading models…';
      const r = await loadModels({ provider: id, apiKey: key, baseUrl: getBaseUrl(), signal: c.signal });
      if (ctrl !== c) return;
      ctrl = null;
      if (!r.ok) { loadMsg.className = 't-sub text-danger'; loadMsg.textContent = `${r.message}${r.detail ? ` (${r.detail})` : ''}`; return; }
      const m = getModel(id);
      replaceChildren(picker,
        el('option', { value: '' }, r.models.length ? `Choose one of ${r.models.length} models…` : 'No models listed'),
        r.models.map((x) => el('option', { value: x.id, selected: x.id === m }, x.label === x.id ? x.id : `${x.label} (${x.id})`)));
      picker.hidden = false;
      loadMsg.className = 't-sub muted';
      loadMsg.textContent = id === 'anthropic' ? 'Showing models that accept images.'
        : id === 'gemini' ? 'Image support not listed; Gemini 4 models accept images.'
          : 'Not filtered: pick a model that accepts images.';
    }

    const schemaToggle = id === 'custom' ? el('label', { class: 'row check-row t-sub' },
      el('input', { type: 'checkbox', checked: getUseSchema(), onChange: (e) => { setUseSchema(e.target.checked); } }),
      el('span', null, 'Send JSON schema · only if supported')) : null;

    const section = el('section', { class: 'section', 'aria-label': 'Model' },
      sectionHeader('Model'),
      el('div', { class: 'card stack' },
        current,
        a.suggested.length ? el('div', { class: 'model-list' }, suggestions) : null,
        el('div', { class: 'row photo-key-actions' }, el('button', { type: 'button', class: 'btn photo-load-models', onClick: load }, icon('list'), 'Load models')),
        loadMsg,
        picker,
        el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); use(free.value.trim()); if (!freeMsg.textContent) free.value = ''; } },
          field('Model id', free),
          freeMsg,
          el('button', { type: 'submit', class: 'btn' }, 'Use this model')),
        schemaToggle,
        el('p', { class: 't-sub muted' }, 'Larger models cost more per photo.',
          a.pricingUrl ? [' ', el('a', { class: 'ext-link', href: a.pricingUrl, target: '_blank', rel: 'noopener noreferrer' }, `${a.name} pricing`, icon('external-link', { size: 14 }))] : null)));
    showCurrent();
    return section;
  }

  // -- notes
  function notesSection(a) {
    return el('section', { class: 'section photo-note', 'aria-label': 'Privacy and cost' },
      sectionHeader('Privacy and cost', { info: 'photo' }),
      el('div', { class: 'card' },
        el('ul', { class: 'plain-list t-sub' },
          a.notes.map((n) => el('li', null, n)),
          el('li', null, 'Analyse sends only the photo (max 1568 px) and your hint to the provider. Test key and Load models are free.'),
          el('li', null, 'Keys stay in this browser, are not in backups, and go only to their provider.'),
          el('li', null, 'Anyone using this browser can use the keys. Set a spend limit with the provider.'))));
  }

  container.append(providerSection, providerBody);
  renderProvider();
  return () => abort();
}


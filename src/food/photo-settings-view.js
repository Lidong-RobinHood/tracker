// Route food/photo-settings: provider choice, then that provider's key (localStorage only), model and test.
import { el, pageHeader, toast, confirmDialog, field, replaceChildren, sectionHeader, icon } from '../ui/index.js';
import { maskKey } from '../core/meal-photo.js';
import { PHOTO_PROVIDERS, PROVIDER_IDS, getAdapter } from '../core/photo-providers.js';
import {
  getProvider, setProvider, getApiKey, setApiKey, deleteApiKey, getModel, setModel,
  getBaseUrl, setBaseUrl, getUseSchema, setUseSchema,
} from './photo-key.js';
import { testApiKey, loadModels, photoErrorText, providerName } from './photo-provider.js';
import { ensureCss } from './widgets.js';
import { t } from '../i18n/index.js';

/** Provider label in the list ('Anthropic (Claude)', translated for the custom one). */
const providerLabel = (a) => (a.labelKey ? t(a.labelKey) : a.label);

export function mountPhotoSettings(container, params, ctx) {
  ensureCss();
  let ctrl = null; // AbortController of a running test / model load
  const abort = () => { if (ctrl) { ctrl.abort(); ctrl = null; } };
  container.append(pageHeader({ title: t('food.photoSettings.title'), subtitle: t('food.photoSettings.subtitle'), back: ctx.query.from === 'add' ? true : 'settings' }));

  // ------------------------------------------------------------ provider picker
  const providerList = el('div', { class: 'list', role: 'radiogroup', 'aria-label': t('food.photoSettings.provider') },
    PROVIDER_IDS.map((id) => {
      const a = PHOTO_PROVIDERS[id];
      const rid = `pp-${id}`;
      const radio = el('input', { type: 'radio', name: 'photo-provider', id: rid, value: id, checked: id === getProvider(),
        onChange: () => { setProvider(id); abort(); renderProvider(); toast(t('food.photoSettings.providerSet', { provider: providerLabel(a) })); } });
      return el('label', { class: 'list-item model-row', htmlFor: rid },
        radio,
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, providerLabel(a)),
          el('div', { class: 'li-sub' }, providerSub(id))));
    }));
  const providerSection = el('section', { class: 'section', 'aria-label': t('food.photoSettings.provider') },
    sectionHeader(t('food.photoSettings.provider')),
    el('div', { class: 'card card-flush' }, providerList),
    el('p', { class: 't-sub muted photo-section-note' }, t('food.photoSettings.providerNote')));

  /** 'key sk-ant…0000 · claude-opus-5-5' (the model id in the id typeface). */
  function providerSub(id) {
    const key = getApiKey(id) ? t('food.photoSettings.keyMasked', { key: maskKey(getApiKey(id)) }) : t('food.photoSettings.noKey');
    return getModel(id) ? [key, ' · ', el('code', { class: 'model-id' }, getModel(id))] : [key];
  }
  function refreshProviderSubs() {
    for (const id of PROVIDER_IDS) {
      const sub = providerList.querySelector(`#pp-${id}`)?.closest('label')?.querySelector('.li-sub');
      if (sub) replaceChildren(sub, ...providerSub(id));
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
      placeholder: 'https://openrouter.ai/api/v1', 'aria-label': t('food.photoSettings.baseUrl'), name: 'photo-base-url', value: getBaseUrl() });
    const msg = el('p', { class: 'field-error', role: 'alert' });
    const save = () => {
      const r = setBaseUrl(input.value);
      if (!r.ok) { msg.textContent = t(r.errorKey); input.setAttribute('aria-invalid', 'true'); return; }
      input.removeAttribute('aria-invalid');
      input.value = r.url;
      msg.textContent = '';
      toast(t('food.photoSettings.baseUrlSaved', { url: r.url }), { type: 'success' });
    };
    return el('section', { class: 'section', 'aria-label': t('food.photoSettings.service') },
      sectionHeader(t('food.photoSettings.service')),
      el('form', { class: 'card stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        field(t('food.photoSettings.baseUrl'), input, { hint: t('food.photoSettings.baseUrlHint') }),
        msg,
        el('button', { type: 'submit', class: 'btn' }, t('food.photoSettings.saveBaseUrl'))));
  }

  // -- key
  function keySection(id, a) {
    const name = providerName(a);
    const keyLabel = t('food.photoSettings.keyLabel', { provider: name });
    const box = el('div', { class: 'stack' });
    const testMsg = el('p', { class: 't-sub', role: 'status' });

    function render() {
      const key = getApiKey(id);
      testMsg.textContent = '';
      if (key) {
        replaceChildren(box,
          el('div', { class: 'row-between' },
            el('div', { class: 'key-row' }, icon('key-round', { class: 'li-lead' }),
              el('div', null, el('div', { class: 'field-label' }, keyLabel), el('div', { class: 'num key-mask' }, maskKey(key)))),
            el('span', { class: 'badge' }, t('food.photoSettings.savedOnDevice'))),
          el('div', { class: 'row photo-key-actions' },
            el('button', { type: 'button', class: 'btn photo-test-key', onClick: test }, icon('check'), t('food.photoSettings.testKey')),
            el('button', { type: 'button', class: 'btn btn-ghost', onClick: replace }, t('food.photoSettings.replace')),
            el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: remove }, icon('trash-2'), t('food.photoSettings.deleteKey'))),
          testMsg);
      } else {
        replaceChildren(box, form());
      }
      refreshProviderSubs();
    }

    function form() {
      const input = el('input', {
        class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
        placeholder: a.keyPlaceholderKey ? t(a.keyPlaceholderKey) : a.keyPlaceholder, 'aria-label': keyLabel, name: `photo-api-key-${id}`, // i18n-ignore (form field name)
      });
      const msg = el('p', { class: 'field-error', role: 'alert' });
      const save = () => {
        const v = input.value.trim();
        if (!v) { msg.textContent = t('food.photoSettings.pasteFirst'); input.focus(); return; }
        if (/\s/.test(v)) { msg.textContent = t('food.photoSettings.noSpaces'); return; }
        if (!setApiKey(id, v)) { msg.textContent = t('food.photoSettings.storageBlockedKey'); return; }
        input.value = '';
        const looksOk = a.keyLooksValid(v);
        toast(looksOk || !a.keyFormatNoteKey ? t('food.photoSettings.keySaved') : t('food.photoSettings.keySavedOdd', { note: t(a.keyFormatNoteKey) }), { type: looksOk ? 'success' : 'info' });
        render();
      };
      return el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } },
        field(keyLabel, input, { hint: t('food.photoSettings.keyHint', { help: t(a.keyHelpKey) }) }),
        msg,
        el('button', { type: 'submit', class: 'btn btn-primary' }, t('food.photoSettings.saveKey')));
    }

    async function test() {
      abort();
      const c = ctrl = new AbortController();
      testMsg.className = 't-sub muted';
      testMsg.textContent = t('food.photoSettings.testing');
      const model = getModel(id);
      const r = await testApiKey({ provider: id, apiKey: getApiKey(id), model, baseUrl: getBaseUrl(), signal: c.signal });
      if (ctrl !== c) return;
      ctrl = null;
      testMsg.className = `t-sub ${r.ok ? 'text-success' : 'text-danger'}`;
      if (r.ok && r.checkedModel) replaceChildren(testMsg, ...withCode(t('food.photoSettings.keyWorksModel'), model));
      else testMsg.textContent = r.ok ? t(model ? 'food.photoSettings.keyWorksLater' : 'food.photoSettings.keyWorks') : `${photoErrorText(r)}${r.detail ? ` (${r.detail})` : ''}`;
    }

    function replace() { replaceChildren(box, form()); requestAnimationFrame(() => { const i = box.querySelector('input'); if (i) i.focus(); }); }

    async function remove() {
      const ok = await confirmDialog({ title: t('food.photoSettings.deleteTitle', { provider: name }), message: t('food.photoSettings.deleteMessage', { provider: name }), confirmLabel: t('food.action.delete'), danger: true });
      if (!ok) return;
      deleteApiKey(id);
      toast(t('food.photoSettings.keyDeleted'));
      render();
    }

    render();
    return el('section', { class: 'section', 'aria-label': t('food.photoSettings.apiKey') }, sectionHeader(t('food.photoSettings.apiKey')), el('div', { class: 'card' }, box));
  }

  // -- model
  function modelSection(id, a) {
    const current = el('p', { class: 't-sub' });
    const loadMsg = el('p', { class: 't-sub', role: 'status' });
    const picker = el('select', { class: 'select photo-model-picker', 'aria-label': t('food.photoSettings.modelsAria'), hidden: true,
      onChange: () => { if (picker.value) use(picker.value); } });
    const free = el('input', { class: 'input model-id-input', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: a.defaultModel || t('food.photoSettings.modelPlaceholder'), 'aria-label': t('food.photoSettings.modelId'), name: `photo-model-${id}` }); // i18n-ignore (form field name)
    const freeMsg = el('p', { class: 'field-error', role: 'alert' });

    function showCurrent() {
      const m = getModel(id);
      replaceChildren(current, ...withCode(t('food.photoSettings.activeModel'), m || null, el('span', { class: 'text-warning' }, t('food.photoSettings.noModel'))));
      for (const r of suggestions.querySelectorAll('input[type=radio]')) r.checked = r.value === m;
      refreshProviderSubs();
    }
    function use(m) {
      if (!setModel(id, m)) { freeMsg.textContent = t('food.photoSettings.badModelId'); return; }
      freeMsg.textContent = '';
      showCurrent();
      toast(t('food.photoSettings.modelSet', { model: getModel(id) }));
    }

    const suggestions = el('div', { class: 'list', role: 'radiogroup', 'aria-label': t('food.photoSettings.suggested') },
      a.suggested.map((s) => {
        const rid = `pm-${id}-${s.id}`;
        return el('label', { class: 'list-item model-row', htmlFor: rid },
          el('input', { type: 'radio', name: `photo-model-${id}-s`, id: rid, value: s.id, onChange: () => use(s.id) }), // i18n-ignore (form field name)
          el('div', { class: 'li-main' },
            el('div', { class: 'li-title' }, s.label, s.id === a.defaultModel ? el('span', { class: 'badge badge-dropset model-default' }, t('food.photoSettings.default')) : null),
            el('div', { class: 'li-sub' }, el('code', { class: 'model-id' }, s.id), s.noteKey ? ` · ${t(s.noteKey)}` : null)));
      }));

    async function load() {
      const key = getApiKey(id);
      if (!key) { loadMsg.className = 't-sub text-danger'; loadMsg.textContent = t('food.photoSettings.saveKeyFirst'); return; }
      abort();
      const c = ctrl = new AbortController();
      loadMsg.className = 't-sub muted';
      loadMsg.textContent = t('food.photoSettings.loadingModels');
      const r = await loadModels({ provider: id, apiKey: key, baseUrl: getBaseUrl(), signal: c.signal });
      if (ctrl !== c) return;
      ctrl = null;
      if (!r.ok) { loadMsg.className = 't-sub text-danger'; loadMsg.textContent = `${photoErrorText(r)}${r.detail ? ` (${r.detail})` : ''}`; return; }
      const m = getModel(id);
      replaceChildren(picker,
        el('option', { value: '' }, r.models.length ? t('food.photoSettings.chooseModel', { count: r.models.length }) : t('food.photoSettings.noModels')),
        r.models.map((x) => el('option', { value: x.id, selected: x.id === m }, x.label === x.id ? x.id : `${x.label} (${x.id})`)));
      picker.hidden = false;
      loadMsg.className = 't-sub muted';
      loadMsg.textContent = t(id === 'anthropic' ? 'food.photoSettings.filteredImages'
        : id === 'gemini' ? 'food.photoSettings.geminiImages'
          : 'food.photoSettings.notFiltered');
    }

    const schemaToggle = id === 'custom' ? el('label', { class: 'row check-row t-sub' },
      el('input', { type: 'checkbox', checked: getUseSchema(), onChange: (e) => { setUseSchema(e.target.checked); } }),
      el('span', null, t('food.photoSettings.sendSchema'))) : null;

    const section = el('section', { class: 'section', 'aria-label': t('food.photoSettings.model') },
      sectionHeader(t('food.photoSettings.model')),
      el('div', { class: 'card stack' },
        current,
        a.suggested.length ? el('div', { class: 'model-list' }, suggestions) : null,
        el('div', { class: 'row photo-key-actions' }, el('button', { type: 'button', class: 'btn photo-load-models', onClick: load }, icon('list'), t('food.photoSettings.loadModels'))),
        loadMsg,
        picker,
        el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); use(free.value.trim()); if (!freeMsg.textContent) free.value = ''; } },
          field(t('food.photoSettings.modelId'), free, { hint: t('food.photoSettings.mustAcceptImages') }),
          freeMsg,
          el('button', { type: 'submit', class: 'btn' }, t('food.photoSettings.useModel'))),
        schemaToggle,
        el('div', { class: 'photo-cost-row t-sub' }, el('span', { class: 'muted' }, t('food.photoSettings.largerCostMore')),
          a.pricingUrl ? el('a', { class: 'ext-link photo-pricing', href: a.pricingUrl, target: '_blank', rel: 'noopener noreferrer' }, t('food.photoSettings.pricing', { provider: providerName(a) }), icon('external-link', { size: 14 })) : null)));
    showCurrent();
    return section;
  }

  // -- notes
  function notesSection(a) {
    return el('section', { class: 'section photo-note', 'aria-label': t('food.photoSettings.privacy') },
      sectionHeader(t('food.photoSettings.privacy'), { info: 'photo' }),
      el('div', { class: 'card' },
        el('ul', { class: 'plain-list t-sub' },
          a.noteKeys.map((k) => el('li', null, t(k))),
          el('li', null, t('food.photoSettings.privacy1')),
          el('li', null, t('food.photoSettings.privacy2')),
          el('li', null, t('food.photoSettings.privacy3')))));
  }

  /** Text with '{model}' replaced by the model id in the id typeface (or `fallback` when there is none). */
  function withCode(text, model, fallback = null) {
    const [before, after = ''] = text.split('{model}');
    return [before, model ? el('code', { class: 'model-id' }, model) : fallback, after];
  }

  container.append(providerSection, providerBody);
  renderProvider();
  return () => abort();
}


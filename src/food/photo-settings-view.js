// Route food/photo-settings: API key (localStorage only), model choice, cost/privacy note.
import { el, pageHeader, toast, confirmDialog, field, replaceChildren } from '../ui/index.js';
import { PHOTO_MODELS, maskKey, keyLooksValid } from '../core/meal-photo.js';
import { getApiKey, setApiKey, deleteApiKey, getPhotoModel, setPhotoModel } from './photo-key.js';
import { testApiKey } from './photo-provider.js';
import { ensureCss } from './widgets.js';

export function mountPhotoSettings(container, params, ctx) {
  ensureCss();
  let testCtrl = null;
  container.append(pageHeader({ title: 'Meal photos', subtitle: 'AI analysis with your own API key', back: ctx.query.from === 'add' ? true : 'settings' }));

  // ------------------------------------------------------------ key
  const keyStatus = el('div', { class: 'stack' });
  const keySection = el('section', { class: 'card stack', 'aria-label': 'API key' });
  const testMsg = el('p', { class: 'small', role: 'status' });

  function renderKey() {
    const key = getApiKey();
    testMsg.textContent = '';
    if (key) {
      replaceChildren(keyStatus,
        el('div', { class: 'row-between' },
          el('div', null, el('div', { class: 'field-label' }, 'Anthropic API key'), el('div', { class: 'num key-mask' }, maskKey(key))),
          el('span', { class: 'badge' }, 'Saved on this device')),
        el('div', { class: 'row photo-key-actions' },
          el('button', { type: 'button', class: 'btn', onClick: test }, 'Test key'),
          el('button', { type: 'button', class: 'btn btn-ghost', onClick: replace }, 'Replace'),
          el('button', { type: 'button', class: 'btn btn-ghost text-danger', onClick: remove }, 'Delete key')),
        testMsg);
    } else {
      replaceChildren(keyStatus, keyForm());
    }
  }

  function keyForm() {
    const input = el('input', {
      class: 'input', type: 'password', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key', name: 'photo-api-key',
    });
    const msg = el('p', { class: 'small field-error', role: 'alert' });
    const save = () => {
      const v = input.value.trim();
      if (!v) { msg.textContent = 'Paste your API key first.'; input.focus(); return; }
      if (/\s/.test(v)) { msg.textContent = 'The key must not contain spaces or line breaks.'; return; }
      if (!setApiKey(v)) { msg.textContent = 'This browser does not allow storing the key (private mode or blocked storage).'; return; }
      input.value = '';
      toast(keyLooksValid(v) ? 'Key saved on this device' : 'Key saved – it does not look like an Anthropic key (sk-ant-…); use “Test key”.', { type: keyLooksValid(v) ? 'success' : 'info' });
      renderKey();
    };
    const form = el('form', { class: 'stack', onSubmit: (e) => { e.preventDefault(); save(); } },
      field('Anthropic API key', input, { hint: 'Create one at console.anthropic.com › API keys. It is stored only in this browser.' }),
      msg,
      el('button', { type: 'submit', class: 'btn btn-primary' }, 'Save key'));
    return form;
  }

  async function test() {
    if (testCtrl) testCtrl.abort();
    const ctrl = testCtrl = new AbortController();
    testMsg.className = 'small muted';
    testMsg.textContent = 'Testing…';
    const r = await testApiKey({ apiKey: getApiKey(), model: getPhotoModel(), signal: ctrl.signal });
    if (ctrl !== testCtrl) return;
    testCtrl = null;
    testMsg.className = `small ${r.ok ? 'text-success' : 'text-danger'}`;
    testMsg.textContent = r.ok ? `The key works and can use ${getPhotoModel()}.` : `${r.message}${r.detail ? ` (${r.detail})` : ''}`;
  }

  function replace() { replaceChildren(keyStatus, keyForm()); requestAnimationFrame(() => { const i = keyStatus.querySelector('input'); if (i) i.focus(); }); }

  async function remove() {
    const ok = await confirmDialog({ title: 'Delete API key?', message: 'The key is removed from this browser. Photo analysis stops working until you add a key again. (To revoke it completely, delete it in the Anthropic Console.)', confirmLabel: 'Delete', danger: true });
    if (!ok) return;
    deleteApiKey();
    toast('API key deleted');
    renderKey();
  }

  keySection.append(el('h2', { class: 'section-title' }, 'API key'), keyStatus);

  // ------------------------------------------------------------ model
  const current = getPhotoModel();
  const modelList = el('div', { class: 'list', role: 'radiogroup', 'aria-label': 'Model' },
    PHOTO_MODELS.map((m) => {
      const id = `pm-${m.id}`;
      const radio = el('input', { type: 'radio', name: 'photo-model', id, value: m.id, checked: m.id === current,
        onChange: () => { setPhotoModel(m.id); toast(`Model: ${m.label}`); } });
      return el('label', { class: 'list-item model-row', htmlFor: id },
        radio,
        el('div', { class: 'li-main' },
          el('div', { class: 'li-title' }, m.label, m.id === PHOTO_MODELS[0].id ? el('span', { class: 'badge model-default' }, 'default') : null),
          el('div', { class: 'li-sub' }, el('code', { class: 'model-id' }, m.id), ` · ${m.note}`)));
    }));
  const modelSection = el('section', { class: 'card stack', 'aria-label': 'Model' },
    el('h2', { class: 'section-title' }, 'Model'), modelList,
    el('p', { class: 'small muted' }, 'More capable models estimate better but cost more per photo and take longer. Prices are Anthropic list prices per million tokens (Nov 2026); one photo is up to about 2,400 image tokens plus about 1,000 tokens of instructions, then the answer and the model’s reasoning.'));

  // ------------------------------------------------------------ note
  const note = el('section', { class: 'card stack photo-note', 'aria-label': 'Privacy and cost' },
    el('h2', { class: 'section-title' }, 'Privacy and cost'),
    el('ul', { class: 'plain-list small' },
      el('li', 'When you tap “Analyse”, the photo (downscaled to 1568 px) and your hint are sent directly from this browser to Anthropic. Nothing else from your diary is sent.'),
      el('li', 'Each analysis is billed to your own Anthropic account. “Test key” is free; it only checks the key.'),
      el('li', 'The key is stored only in this browser’s local storage. It is not part of the backup/export file and is never sent anywhere except to Anthropic.'),
      el('li', 'Anyone who can use this browser profile can use the key. Delete it here if you share the device, and set a spend limit in the Anthropic Console.'),
      el('li', 'For Fable, Opus and Sonnet the request allows Anthropic’s automatic fallback to another model if the first one declines; that run is billed too.')));

  container.append(keySection, modelSection, note);
  renderKey();
  return () => { if (testCtrl) testCtrl.abort(); };
}

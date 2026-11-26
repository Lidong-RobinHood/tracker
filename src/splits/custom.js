// Custom split editor (autosaved): name, weekly sets (same card as a library split), sessions per week,
// the rotation (reorder, duplicate, replace, remove, add; tap opens the routine in the routine editor),
// Follow / Stop following, Delete. Route: workout/splits/custom/:id. Rules in docs/SPLITS.md › Custom splits.
import * as db from '../db/db.js';
import {
  el, append, replaceChildren, pageHeader, sectionHeader, cardHeader, segmented, tag, icon, iconButton, infoButton, href,
  setBodyMapValues, openSheet, toast, fmtNum, navigate, emptyState, confirmDialog,
} from '../ui/index.js';
import { MUSCLES } from '../core/muscles.js';
import { t } from '../i18n/index.js';
import { muscleName, splitName, routineName, nameForSave } from '../i18n/names.js';
import { sanitiseTargets, volumeWeights } from '../core/volume.js';
import {
  coverageStep, coverageBands, coverageNotes, targetsFromCoverage, sessionsPerWeekOf, moveSession, duplicateSession,
  removeSession, replaceSession, MIN_PER_WEEK, MAX_PER_WEEK, MAX_ROTATION, MAX_NAME,
} from '../core/splits.js';
import { mapSteps } from '../core/routine-sets.js';
import { loadExercises, loadRoutines } from '../workout/data.js';
import { setsMap, setsMapRow, setsRow, setsList } from '../workout/muscle-map.js';
import {
  ensureSplitsCss, loadCustomSplit, saveCustomSplit, deleteCustomSplit, customCoverage, loadActiveSplit, stopFollowing,
  followCustom, splitPath, TARGETS_KEY,
} from './store.js';
import { routineList, newSessionRoutine } from './custom-new.js';

const view = { sets: 'map' }; // Map / Sets toggle, kept while the app runs (as on a library split)

export async function mountCustom(container, params, ctx) {
  ensureSplitsCss();
  const [loaded, routines, exMap, weights, rawTargets, active] = await Promise.all([
    loadCustomSplit(params.id), loadRoutines(), loadExercises(), db.getSetting('volume'), db.getSetting(TARGETS_KEY), loadActiveSplit(),
  ]);
  if (!loaded) {
    append(container, pageHeader({ title: t('splits.split'), back: 'workout/splits' }), emptyState(t('splits.notFound'),
      el('a', { class: 'btn', href: href('workout/splits') }, t('splits.all'))));
    return undefined;
  }
  const cs = loaded;
  const byId = new Map(routines.map((r) => [r.id, r]));
  const targets = sanitiseTargets(rawTargets);
  let following = !!(active && active.splitId === cs.id);
  const self = splitPath(cs.id);

  // Saves run one after another with the latest state.
  let chain = Promise.resolve();
  const save = () => {
    chain = chain.then(() => saveCustomSplit(cs)).catch((err) => { console.error(err); toast(t('splits.saveFailed'), { type: 'error' }); });
    return chain;
  };

  let current = customCoverage(cs, byId, exMap, weights);

  // ------------------------------------------------ header + name
  const header = pageHeader({ title: splitName(cs), subtitle: t('splits.custom.autosaved'), back: 'workout/splits' });
  const titleEl = header.querySelector('.page-title');
  const tags = el('div', { class: 'sp-tags' });
  const stored = { name: cs.name, shown: splitName(cs) };
  const name = el('input', {
    class: 'input', type: 'text', value: stored.shown, maxlength: String(MAX_NAME), id: 'sp-cs-name',
    onInput: () => {
      const n = name.value.trim();
      if (!n) return;
      cs.name = nameForSave(stored.name, stored.shown, n); titleEl.textContent = n; save();
    },
  });

  // ------------------------------------------------ weekly sets (same card as a library split)
  const map = setsMap();
  const setsBody = el('div', { class: 'sp-sets-body' });
  const note = el('p', { class: 't-sub muted sp-note' });
  const paintSets = () => {
    const cov = current.coverage;
    map.setAttribute('aria-label', t('splits.sets.mapAria', { list: MUSCLES.map((m) => `${muscleName(m.id)} ${fmtNum(cov[m.id].total, 1)}`).join(t('splits.listSep')) }));
    setBodyMapValues(map, mapSteps(cov, coverageStep));
    if (view.sets === 'map') replaceChildren(setsBody, setsMapRow(map, coverageBands(weights), t('splits.sets.title')));
    else replaceChildren(setsBody, setsList(MUSCLES.map((m) => setsRow(muscleName(m.id), cov[m.id], {
      step: coverageStep(cov[m.id].total), extra: [t('splits.daysN', { count: cov[m.id].daysHit, n: fmtNum(cov[m.id].daysHit, 1) })], target: targets[m.id],
    }))));
    // Quiet facts, no advice: muscles with no sets, and muscles far above the rest (rule: coverageNotes).
    const n = coverageNotes(cov);
    const names = (ids) => ids.map(muscleName).join(t('splits.listSep'));
    const parts = [n.none.length ? t('splits.note.none', { list: names(n.none) }) : null, n.high.length ? t('splits.note.high', { list: names(n.high) }) : null].filter(Boolean);
    replaceChildren(note, parts.length ? [icon('info', { size: 16 }), el('span', parts.join(' · '))] : null);
    note.hidden = !parts.length;
  };
  const setsToggle = segmented({
    small: true, ariaLabel: t('splits.sets.showAs'), value: view.sets,
    options: [{ value: 'map', label: t('splits.sets.map') }, { value: 'list', label: t('splits.sets.list') }],
    onChange: (v) => { view.sets = v; paintSets(); },
  });
  const setsHeader = cardHeader(t('splits.sets.title'), { trail: setsToggle });
  setsHeader.querySelector('.card-title').after(infoButton('split-sets', { values: volumeWeights(weights) }));

  // sessions per week: the rotation length unless set (1–7); the rotation and the week need not match
  const perWeekVal = el('output', { class: 'sp-stepper-val', id: 'sp-pw-val', 'aria-live': 'polite' });
  const perWeekHint = el('span', { class: 't-sub muted' });
  const minus = iconButton('minus', { label: t('splits.custom.fewer'), variant: 'secondary', onClick: () => setPerWeek(-1) });
  const plus = iconButton('plus', { label: t('splits.custom.more'), variant: 'secondary', onClick: () => setPerWeek(1) });
  const setPerWeek = (d) => {
    const v = Math.min(MAX_PER_WEEK, Math.max(MIN_PER_WEEK, sessionsPerWeekOf(cs) + d));
    cs.sessionsPerWeek = v;
    save();
    recompute();
  };
  const paintPerWeek = () => {
    const v = sessionsPerWeekOf(cs);
    perWeekVal.textContent = String(v);
    minus.disabled = v <= MIN_PER_WEEK;
    plus.disabled = v >= MAX_PER_WEEK;
    const len = current.state.ids.length;
    perWeekHint.textContent = len && len !== v ? t('splits.custom.rotationOf', { n: len }) : '';
  };
  const setsCard = el('section', { class: 'card sp-sets-card' },
    setsHeader, setsBody, note,
    el('div', { class: 'sp-level sp-perweek' },
      el('span', { class: 't-cap muted', id: 'sp-pw-label' }, t('splits.custom.perWeek')),
      el('div', { class: 'sp-stepper-row' },
        el('div', { class: 'sp-stepper', role: 'group', 'aria-labelledby': 'sp-pw-label' }, minus, perWeekVal, plus),
        perWeekHint)));

  // ------------------------------------------------ rotation
  const rotBox = el('div', { class: 'section' });
  const setSessions = (next) => { cs.sessions = next; save(); recompute(); };
  const rowName = (id) => (byId.get(id) ? routineName(byId.get(id)) : t('splits.custom.missingRoutine'));

  const paintRotation = () => {
    const ses = cs.sessions;
    const rows = ses.map((id, i) => {
      const r = byId.get(id);
      const nm = rowName(id);
      const sets = r ? r.items.reduce((a, it) => a + (it.targetSets || 0), 0) : 0;
      const main = r
        ? el('a', { class: 'li-main sp-rot-main', href: href(`workout/routines/${encodeURIComponent(id)}?back=${encodeURIComponent(self)}`) },
          el('div', { class: 'li-title' }, nm),
          el('div', { class: 'li-sub' }, `${t('splits.exercises', { count: r.items.length })} · ${t('splits.sets.count', { count: sets })}`))
        : el('button', { type: 'button', class: 'li-main sp-rot-main', onClick: () => openRowMenu(i), 'aria-haspopup': 'dialog' },
          el('div', { class: 'li-title sp-missing' }, icon('alert-triangle', { size: 16 }), nm),
          el('div', { class: 'li-sub' }, t('splits.custom.removeOrReplace')));
      return el('li', { class: ['list-item', 'sp-rot-row', r ? null : 'is-missing'] },
        el('span', { class: 'sp-day-n', 'aria-hidden': 'true' }, String(i + 1)),
        main,
        el('div', { class: 'sp-rot-btns' },
          iconButton('arrow-up', { label: t('splits.custom.moveUp', { name: nm, i: i + 1 }), disabled: i === 0, onClick: () => { setSessions(moveSession(ses, i, -1)); focusRow(i - 1, 'up'); } }),
          iconButton('arrow-down', { label: t('splits.custom.moveDown', { name: nm, i: i + 1 }), disabled: i === ses.length - 1, onClick: () => { setSessions(moveSession(ses, i, 1)); focusRow(i + 1, 'down'); } }),
          iconButton('ellipsis', { label: t('splits.custom.moreFor', { name: nm, i: i + 1 }), onClick: () => openRowMenu(i) })));
    });
    replaceChildren(rotBox,
      sectionHeader(t('splits.rotation'), { trail: ses.length ? t('splits.sessions', { count: ses.length }) : null }),
      ses.length
        ? el('ol', { class: 'card card-flush list sp-rot', 'aria-label': t('splits.rotation') }, rows)
        : el('div', { class: 'card' }, emptyState(t('splits.custom.empty'))),
      el('button', { type: 'button', class: 'btn btn-block sp-add', onClick: openAdd, disabled: ses.length >= MAX_ROTATION }, icon('plus'), t('splits.custom.addSession')));
  };
  // keep keyboard focus on the moved row's button
  const focusRow = (i, dir) => requestAnimationFrame(() => {
    const row = rotBox.querySelectorAll('.sp-rot-row')[i];
    const b = row && row.querySelector(`.sp-rot-btns .btn:nth-child(${dir === 'up' ? 1 : 2})`);
    if (b && !b.disabled) b.focus(); else if (row) row.querySelector('.sp-rot-btns .btn:not([disabled])')?.focus();
  });

  function openAdd() {
    const sheet = openSheet({ title: t('splits.custom.addSession'), className: 'sp-pick-sheet' });
    append(sheet.body, routineList(routines, {
      onPick: (r) => { setSessions([...cs.sessions, r.id]); sheet.close(); },
      onNew: async () => {
        sheet.close();
        try {
          await newSessionRoutine(async (rid) => { cs.sessions = [...cs.sessions, rid]; await save(); }, self);
        } catch (err) { console.error(err); toast(t('splits.custom.createRoutineFailed'), { type: 'error' }); }
      },
    }));
  }

  function openRowMenu(i) {
    const id = cs.sessions[i];
    const r = byId.get(id);
    const sheet = openSheet({ title: `${i + 1}. ${rowName(id)}`, className: 'sp-row-menu' });
    const item = (iconName, label, onClick, cls) => el('button', { type: 'button', class: ['list-item', cls], onClick },
      icon(iconName, { class: 'li-lead' }), el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, label)));
    const removeIt = () => {
      const before = cs.sessions;
      sheet.close();
      setSessions(removeSession(before, i));
      toast(t('splits.custom.removed', { name: rowName(id) }), { action: { label: t('splits.undo'), onClick: () => setSessions(before) } });
    };
    append(sheet.body, el('div', { class: 'list' },
      r ? item('copy', t('splits.custom.duplicate'), () => { sheet.close(); setSessions(duplicateSession(cs.sessions, i)); }) : null,
      item('repeat', t('splits.custom.replace'), () => {
        replaceChildren(sheet.body, routineList(routines.filter((x) => x.id !== id), {
          verb: 'use', onPick: (x) => { sheet.close(); setSessions(replaceSession(cs.sessions, i, x.id)); },
        }));
      }),
      item('trash-2', t('splits.custom.remove'), removeIt, 'sp-danger')));
  }

  // ------------------------------------------------ follow / delete
  const actions = el('div', { class: 'stack sp-actions' });
  const paintActions = () => {
    replaceChildren(tags,
      tag(t('splits.days', { count: sessionsPerWeekOf(cs) }), { tone: 'accent' }),
      following ? tag(t('splits.following'), { tone: 'ok', icon: 'check' }) : null);
    replaceChildren(actions,
      following
        ? el('button', {
          type: 'button', class: 'btn btn-ghost btn-block',
          onClick: async () => {
            if (!(await confirmDialog({ title: t('splits.stop.title'), message: t('splits.stop.message'), confirmLabel: t('splits.stop.button') }))) return;
            try { await stopFollowing(); } catch (err) { console.error(err); toast(t('splits.saveFailed'), { type: 'error' }); return; }
            following = false; paintActions();
          },
        }, t('splits.stop.button'))
        : el('button', { type: 'button', class: 'btn btn-primary btn-block', onClick: openFollow, disabled: !current.state.ok }, t('splits.follow.this')),
      el('button', { type: 'button', class: 'btn btn-ghost btn-block text-danger', onClick: del }, t('splits.custom.delete')));
  };

  async function openFollow() {
    await chain;
    const newTargets = targetsFromCoverage(current.coverage);
    const opts = { setTargets: false };
    const sheet = openSheet({ title: t('splits.follow.title', { name: splitName(cs) }), className: 'sp-adopt' });
    const newTargetsText = MUSCLES.filter((m) => newTargets[m.id]).map((m) => `${muscleName(m.id)} ${fmtNum(newTargets[m.id], 0)}`).join(' · ');
    const targetsLine = el('p', { class: 'field-hint sp-targets-line' });
    const paintTargets = () => { targetsLine.textContent = opts.setTargets ? t('splits.targets.replaces', { list: newTargetsText || t('splits.targets.none') }) : t('splits.targets.stay'); };
    paintTargets();
    const tick = el('input', { type: 'checkbox', class: 'switch', id: 'sp-cs-targets', onChange: () => { opts.setTargets = tick.checked; paintTargets(); } });
    append(sheet.body,
      el('ol', { class: 'list sp-adopt-list' }, current.state.ids.map((id, i) => el('li', { class: 'list-item' },
        el('span', { class: 'sp-day-n', 'aria-hidden': 'true' }, String(i + 1)),
        el('div', { class: 'li-main' }, el('div', { class: 'li-title' }, routineName(byId.get(id))))))),
      el('div', { class: 'sp-adopt-meta t-sub muted' }, t('splits.custom.followMeta', { count: sessionsPerWeekOf(cs) })),
      el('label', { class: 'sp-tick', htmlFor: 'sp-cs-targets' }, el('span', { class: 'grow' }, t('splits.targets.set')), tick),
      targetsLine);
    append(sheet.footer, el('button', {
      type: 'button', class: 'btn btn-primary btn-block',
      onClick: async () => {
        try {
          await followCustom(cs, { setTargets: opts.setTargets, coverage: current.coverage });
          sheet.close();
          toast(t('splits.custom.followingToast', { name: splitName(cs) }), { type: 'success' });
          navigate('workout');
        } catch (err) {
          console.error(err);
          toast(t('splits.saveFailed'), { type: 'error' });
        }
      },
    }, t('splits.follow.button')));
  }

  async function del() {
    const ok = await confirmDialog({
      title: t('splits.custom.deleteTitle'),
      message: following ? t('splits.custom.deleteFollowing') : t('splits.stop.message'),
      confirmLabel: t('splits.delete'), danger: true,
    });
    if (!ok) return;
    await chain;
    try { await deleteCustomSplit(cs.id); } catch (err) { console.error(err); toast(t('splits.custom.deleteFailed'), { type: 'error' }); return; }
    navigate('workout/splits', { replace: true });
  }

  function recompute() {
    current = customCoverage(cs, byId, exMap, weights);
    paintSets();
    paintPerWeek();
    paintRotation();
    paintActions();
  }

  append(container, header,
    el('div', { class: 'sp-head' }, tags),
    el('div', { class: 'field' }, el('label', { class: 'field-label', htmlFor: 'sp-cs-name' }, t('splits.name')), name),
    setsCard, rotBox, actions);
  recompute();

  if (ctx && ctx.query && ctx.query.new) {
    name.focus(); name.select();
    // once only: a reload must not focus the name again
    history.replaceState(history.state, '', `#/${self}`);
  }
  return undefined; // every change is saved as it happens
}

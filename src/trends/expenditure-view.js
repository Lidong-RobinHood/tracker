// Expenditure & target: TDEE estimate with status/confidence and its data basis, goal, proposed
// target, the weekly check-in (Accept / Keep current) and the target history. Route: trends/expenditure
import { el, replaceChildren, pageHeader, toast, fmtNum, fmtDate, href } from '../ui/index.js';
import { addDays } from '../core/dates.js';
import { adaptiveConfig } from '../core/adaptive.js';
import { ensureCss, loadTrendsData, answerCheckIn, signed, goalText, CONFIDENCE_LABEL } from './data.js';

export async function mountExpenditure(container) {
  ensureCss();
  container.append(pageHeader({ title: 'Expenditure & target', back: 'trends' }));
  const body = el('div', { class: 'stack' });
  container.append(body);

  async function render() {
    const d = await loadTrendsData();
    replaceChildren(body,
      estimateCard(d),
      checkInSection(d, async (decision) => {
        try {
          const rec = await answerCheckIn(d.checkIn, decision);
          toast(decision === 'accepted' ? `New target: ${fmtNum(rec.history.kcalTarget, 0)} kcal a day` : 'Kept your current targets', { type: 'success' });
        } catch (err) {
          console.error(err);
          toast(`Could not save: ${err.message}`, { type: 'error' });
        }
        render();
      }),
      historySection(d.history));
  }
  await render();
}

// ---------------------------------------------------------------- estimate

function estimateCard(d) {
  const e = d.estimate;
  const b = e.basis;
  const head = el('div', { class: 'card-header' }, el('h2', { class: 'card-title' }, 'Expenditure (TDEE)'),
    e.status === 'ok'
      ? el('span', { class: ['badge', e.confidence === 'low' ? 'badge-warning' : null] }, CONFIDENCE_LABEL[e.confidence])
      : el('span', { class: 'badge badge-warning' }, 'Not enough data'));
  const items = [head];
  if (e.status === 'ok') {
    items.push(
      el('div', { class: 'tr-big' }, el('span', { class: 'num' }, fmtNum(Math.round(e.tdee / 10) * 10, 0)), el('span', { class: 'muted' }, ' kcal / day')),
      el('p', { class: 'small muted' }, `Estimated from your data, ± ${fmtNum(Math.round(e.se / 10) * 10, 0)} kcal. Calories you burn per day on average, including training.`));
  } else {
    items.push(
      el('p', 'An estimate from your own data needs a little more logging:'),
      el('ul', { class: 'tr-missing' }, e.missing.map((m) => el('li', m))));
    if (e.formula) {
      items.push(el('div', { class: 'tr-formula' },
        el('div', { class: 'small muted' }, 'Formula estimate (Mifflin-St Jeor × activity) — not based on your data'),
        el('div', { class: 'tr-big' }, el('span', { class: 'num' }, fmtNum(Math.round(e.formula.kcal / 10) * 10, 0)), el('span', { class: 'muted' }, ' kcal / day'))));
    } else {
      items.push(el('p', { class: 'small muted' }, 'Until then: fill in sex, birth year, height and activity in ',
        el('a', { href: href('settings') }, 'Settings'), ' for a formula estimate.'));
    }
  }
  items.push(el('div', { class: 'list tr-basis' },
    row('Weigh-ins (last 28 days)', `${b.weighIns}`),
    row('Fully logged days (last 28 days)', `${b.loggedDays}${b.incompleteDays ? ` (+${b.incompleteDays} ignored as incomplete)` : ''}`),
    row('Average intake on those days', b.meanIntake === null ? '–' : `${fmtNum(b.meanIntake, 0)} kcal`),
    row('Trend weight', b.trendKg === null ? '–' : `${fmtNum(b.trendKg, 1)} kg`),
    row('Weight change', b.rateKgPerWeek === null ? '–' : `${signed(b.rateKgPerWeek, 2)} kg / week`)));
  items.push(el('p', { class: 'small muted' }, 'Today is not counted (the day is not over). Logged days under half of your usual intake count as incomplete and are left out.'));
  return el('section', { class: 'card stack' }, items);
}

function row(label, value) {
  return el('div', { class: 'list-item' }, el('span', { class: 'li-main small' }, label), el('span', { class: 'li-trail small' }, value));
}

// ---------------------------------------------------------------- check-in

function checkInSection(d, answer) {
  const ci = d.checkIn;
  const done = d.doneThisWeek;
  const title = el('h2', { class: 'section-title' }, `Weekly check-in · week of ${fmtDate(ci.weekStart)}`);
  const goal = el('div', { class: 'row-between' },
    el('div', null, el('div', { class: 'small muted' }, 'Goal'), el('div', { class: 'tr-strong' }, goalText(d.goal.rateKgPerWeek))),
    el('a', { class: 'btn btn-sm', href: href('settings') }, 'Change'));

  const review = el('div', { class: 'list tr-basis' },
    row(`Last week (${fmtDate(ci.reviewFrom)} – ${fmtDate(ci.reviewTo)})`, ''),
    row('Average intake', ci.avgIntake === null ? 'nothing logged' : `${fmtNum(ci.avgIntake, 0)} kcal (${ci.daysLogged} day${ci.daysLogged === 1 ? '' : 's'})`),
    row('Trend weight change', ci.trendChange === null ? '–' : `${signed(ci.trendChange, 2)} kg`),
    row(ci.basisKind === 'formula' ? 'Expenditure (formula)' : `Expenditure as of ${fmtDate(ci.weekStart)}`,
      ci.tdee === null ? 'not available' : `${fmtNum(Math.round(ci.tdee / 10) * 10, 0)} kcal`));

  const cards = [goal, review];
  if (!ci.proposal) {
    cards.push(el('p', { class: 'muted small' }, ci.weightKg === null
      ? 'Log your weight to get a proposed target.'
      : 'No proposal yet: keep logging food and weight, or complete your profile in Settings for a formula-based start.'));
    return el('section', { class: 'section' }, title, el('div', { class: 'card stack' }, cards));
  }

  const p = ci.proposal;
  const t = d.targets;
  const cmp = el('table', { class: 'tr-table num' },
    el('thead', el('tr', el('th', ''), el('th', 'Current'), el('th', 'Proposed'))),
    el('tbody',
      [['Calories', 'kcal', 'kcal'], ['Protein', 'protein', 'g'], ['Carbs', 'carbs', 'g'], ['Fat', 'fat', 'g']].map(([label, k, unit]) => el('tr',
        el('th', label),
        el('td', `${fmtNum(t[k], 0)} ${unit}`),
        el('td', { class: p[k] !== t[k] ? 'tr-changed' : null }, `${fmtNum(p[k], 0)} ${unit}`)))));
  cards.push(cmp);
  const notes = [];
  if (ci.basisKind === 'formula') notes.push('Based on the formula estimate, not yet on your data.');
  if (p.limitedBy === 'change') notes.push(`Limited to ${fmtNum(adaptiveConfig(d.config).maxWeeklyChange, 0)} kcal change per week (unlimited would be ${fmtNum(Math.round(p.rawKcal / 10) * 10, 0)} kcal).`);
  if (p.limitedBy === 'floor') notes.push(`Raised to your calorie floor (unlimited would be ${fmtNum(Math.round(p.rawKcal / 10) * 10, 0)} kcal).`);
  if (p.proteinLimited && p.split !== 'percent') notes.push(`Protein capped at ${fmtNum(p.protein, 0)} g so the macros fit the calories (your per-kg setting would be ${fmtNum(p.proteinWanted, 0)} g).`);
  if (p.split === 'percent' && t.pct) notes.push(`Macros follow your split of ${fmtNum(t.pct.protein)} % protein, ${fmtNum(t.pct.carbs)} % carbs, ${fmtNum(t.pct.fat)} % fat (set in Settings); only the calories adapt.`);
  if (t.source !== 'adaptive') notes.push('Your targets are set manually. Accepting switches them to adaptive.');
  if (notes.length) cards.push(el('div', { class: 'stack tr-notes' }, notes.map((n) => el('p', { class: 'small muted' }, n))));

  if (done) {
    cards.push(el('p', { class: 'tr-done small' },
      done.decision === 'accepted' ? `Done: you accepted ${fmtNum(done.kcalTarget, 0)} kcal for this week.` : 'Done: you kept your current targets this week.',
      ` Next check-in on ${fmtDate(addDays(ci.weekStart, 7))}.`));
    if (done.decision === 'kept') cards.push(el('button', { class: 'btn btn-sm btn-block', type: 'button', onClick: () => answer('accepted') }, 'Accept the proposal instead'));
  } else {
    cards.push(el('div', { class: 'row' },
      el('button', { class: 'btn grow', type: 'button', onClick: () => answer('kept') }, 'Keep current'),
      el('button', { class: 'btn btn-primary grow', type: 'button', onClick: () => answer('accepted') }, 'Accept')));
  }
  return el('section', { class: 'section', id: 'checkin' }, title, el('div', { class: 'card stack' }, cards));
}

function historySection(history) {
  if (!history.length) return null;
  return el('section', { class: 'section' }, el('h2', { class: 'section-title' }, 'Target history'),
    el('div', { class: 'card card-flush' }, el('div', { class: 'list' }, history.slice(0, 26).map((h) => el('div', { class: 'list-item' },
      el('div', { class: 'li-main' },
        el('div', { class: 'li-title' }, `Week of ${fmtDate(h.weekStart)}`),
        el('div', { class: 'li-sub' }, `${h.decision === 'kept' ? 'Kept' : 'Accepted'} · TDEE ${h.tdee === null || h.tdee === undefined ? '–' : fmtNum(h.tdee, 0)}${h.basis === 'formula' ? ' (formula)' : ''} · ${h.daysLogged} days logged`)),
      el('span', { class: 'li-trail num' }, `${fmtNum(h.kcalTarget, 0)} kcal`))))));
}

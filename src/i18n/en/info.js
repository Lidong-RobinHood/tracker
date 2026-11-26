// en catalogue, namespace 'info'. Flat 'key': 'text' with {placeholders}; see docs/I18N.md.
// Info sheets (src/ui/info-sheets.js): title + 1–3 short paragraphs each, ≤ ~60 words per sheet.
export default {
  'info.recovery.title': 'Muscle recovery',
  'info.recovery.p1': 'An estimate, not a measurement. Ranges start as a rule of thumb: hard-trained muscles usually get 48–72 h, smaller ones less, legs more.',
  'info.recovery.p2': 'Recovering = before the range · likely ready = inside · recovered = past it. Tap a muscle to check in; after about {minPoints} check-ins the range is yours. Pace only scales the rule of thumb.',

  'info.recoveryMath.title': 'How sets scale the window',
  'info.recoveryMath.p1': 'Sets count like weekly sets. Ranges are for {ref} hard sets: 1 set × {f1}, 8 sets × {f8}, 9 or more × {fMax}. Under {minDose} counted set does not restart the clock.',
  'info.recoveryMath.p2': 'Training again inside the window carries the leftover load over. Rule-of-thumb ranges stay within {capMin}–{capMax} h, yours within {customMin}–{customMax} h. Only the last {days} days count.',

  'info.recoveryYours.title': 'Your ranges',
  'info.recoveryYours.p1': 'Still sore means recovery took longer; recovered means shorter. Answers are scaled to {ref} sets, recent workouts count more, and contradicting answers within one workout are left out.',
  'info.recoveryYours.p2': 'After {minPoints} useful check-ins from {minBouts} workouts, with both answers, the range becomes yours: the middle of your answers, wider while they are few. A hand-set range still wins.',

  'info.sets.title': 'Weekly sets',
  'info.sets.p1': 'Done normal sets per muscle, Monday to Sunday. Direct (the muscle is a main mover) counts × {primary}; partial (it assists) × {secondary}; dropsets × {dropset}.',
  'info.sets.p2': 'Change the factors in Settings › Set weighting. With a target, a row shows done / target and the bar fills at 100 %.',

  'info.setsWorkout.title': 'Sets per muscle',
  'info.setsWorkout.p1': 'Done normal sets of this workout per muscle. Direct (the muscle is a main mover) counts × {primary}; partial (it assists) × {secondary}; dropsets × {dropset}.',
  'info.setsWorkout.p2': 'They add to the weekly sets of that week.',

  'info.tonnage.title': 'Tonnage',
  'info.tonnage.p1': 'Weight × reps of done normal sets, in kg; from {tFrom} kg in t (1 t = {tKg} kg). Single sets and exercises always in kg. Dropsets are shown separately; bodyweight sets count 0 kg.',
  'info.tonnage.p2': 'By muscle: each exercise’s tonnage goes to its direct muscles, split equally. Routine charts show the last 8 sessions; % = change vs the session before.',

  'info.records.title': 'Records',
  'info.records.p1': 'A record beats every earlier session of that exercise: heaviest set, tonnage set, est. 1RM, session tonnage, or reps for bodyweight. Only done normal sets count. The first session sets the mark.',
  'info.records.p2': 'This month compares with the same days last month; the starting point and unfinished workouts are not counted.',

  'info.metrics.title': 'Progress metrics',
  'info.metrics.p1': 'Top set: heaviest done set; more reps wins a tie. Est. 1RM (Epley): weight × (1 + reps / 30). Tonnage: weight × reps of done sets.',
  'info.metrics.p2': 'Best reps: most reps in one set. Total reps: all done sets. Dropsets never count. Bodyweight exercises progress by reps. Highlighted points are records.',

  'info.topExercises.title': 'Top exercises',
  'info.topExercises.p1': 'Exercises with the most sessions in the last 8 weeks. Value = latest session’s best est. 1RM, or most reps in a set for bodyweight. % = change vs the first session in those 8 weeks.',

  'info.progression.title': 'Weight suggestions',
  'info.progression.p1': 'All target sets at your top weight must reach the target reps (the top of a range like 3 × 6–8); then a chip suggests that weight + the weight step. Lighter warm-up and back-off sets are ignored, dropsets never count, and the starting point never triggers it.',
  'info.progression.p2': 'Nothing changes until you tap the chip. Weight step 0 = no suggestions.',

  'info.starting.title': 'Starting point',
  'info.starting.p1': 'Your current working weight × reps × sets per exercise, plus your best set if it differs. Pre-fills sessions and counts for records.',
  'info.starting.p2': 'It is never a workout and never triggers a weight suggestion; that needs a real session.',

  'info.photo.title': 'Meal photo estimates',
  'info.photo.p1': 'An AI model estimates foods, grams, calories and macros from the photo. These are estimates: check them before adding.',
  'info.photo.p2': 'Each analysis is billed to your own provider account; a cancelled request may still be billed. Only the photo (max {px} px) and your hint are sent.',
  'info.photo.p3': 'Some providers block browser calls; zero-data-retention organisations cannot call Anthropic from a browser.',

  'info.camera.title': 'Allow the camera',
  'info.camera.p1': 'iPhone: Settings › Safari › Camera, or the aA menu in the address bar. Android: lock icon in the address bar › Permissions. Then tap Scan again.',

  'info.expenditure.title': 'Expenditure',
  'info.expenditure.p1': 'Average kcal / day you burn, including training. From your data: estimated from logged food and the weight trend.',
  'info.expenditure.p2': 'It needs, in the last {windowDays} days, {minWeighIns} weigh-ins and {minLoggedDays} complete days, plus {minSpanDays} days of history and a weigh-in in the last {maxStaleDays} days. Until then: formula (Mifflin-St Jeor × activity) from your profile. Skipped days make it too low.',

  'info.checkin.title': 'Weekly check-in',
  'info.checkin.p1': 'Each Monday, Trends proposes calorie targets for the week from your expenditure and goal. Accept applies them; Keep current changes nothing.',
  'info.checkin.p2': 'Changes are capped at {maxChange} kcal / week and never go below the calorie floor.',

  'info.complete.title': 'Complete days',
  'info.complete.p1': 'Today never counts. A logged day under half of your usual intake (median of logged days within ± {weeks} weeks) is incomplete, probably not fully logged.',
  'info.complete.p2': 'Incomplete days are left out of averages, on-target days, highest and lowest day, totals and the expenditure estimate. On target = a complete day within ± 10 % of the calorie target.',

  'info.trend.title': 'Weight trend',
  'info.trend.p1': 'A moving average that smooths out day-to-day water swings. Watch the trend, not single days. Weigh in each morning, after the toilet and before eating.',
  'info.trend.p2': 'The trend starts with the second weigh-in. Weekly change compares with the trend at the end of the previous Sunday.',

  'info.report.title': 'Weekly report',
  'info.report.p1': 'Weeks run Monday to Sunday; only weeks with something logged are listed. Change = (this − last) / last; – when last week has no value.',
  'info.report.p2': 'Targets come from that week’s check-in. Manual target changes are not recorded, so past weeks may show other targets than you used.',

  'info.macros.title': 'Macro percentages',
  'info.macros.p1': 'Protein and carbs 4 kcal / g, fat 9 kcal / g. Grams are rounded to whole numbers.',
  'info.macros.p2': 'Weekly report splits use complete days only.',

  'info.adaptiveMacros.title': 'Adaptive macros',
  'info.adaptiveMacros.p1': 'Protein and fat are set in g / kg of trend weight; carbs fill the rest.',
  'info.adaptiveMacros.p2': 'Calorie floor: the lowest target ever proposed. Empty = {female} kcal female, {male} male, {unknown} otherwise.',
  'info.adaptiveMacros.p3': 'With a percentage split, check-ins change calories only and these values are not used.',

  'info.goal.title': 'Weight goal',
  'info.goal.p1': 'Lose up to {lose} kg or gain up to {gain} kg / week. The kcal figure is the daily gap to your expenditure this rate needs, at {kcalPerKg} kcal / kg.',
  'info.goal.p2': 'The weekly check-in uses it to propose targets.',

  'info.backup.title': 'Backup',
  'info.backup.p1': 'All data lives only in this browser on this device: no account, no cloud, no sync. Export backup regularly and keep the file elsewhere, such as a cloud drive or an e-mail to yourself.',
  'info.backup.p2': 'New phone: Export backup here, then Import backup there; it replaces everything. API keys are not in the backup. The app reminds you after {days} days.',

  'info.storage.title': 'Storage protection',
  'info.storage.p1': 'Protected: the browser will not delete the data on its own; clearing site data or removing the app still does.',
  'info.storage.p2': 'Not protected: the browser may delete the data when space runs low. Installing the app and keeping backups help.',

  'info.importWeights.title': 'Weight file format',
  'info.importWeights.p1': 'Dates like 12.11.2026, 2026-11-12, 12/11/26 or Mon 12 Nov. Weights like 82,5 or 82.5, in kg; pounds are not supported.',
  'info.importWeights.p2': 'Columns separated by tab, semicolon, comma or space, in either order. A header row is fine.',

  'info.importWorkouts.title': 'Workout paste format',
  'info.importWorkouts.p1': 'Exercise name on its own line, then 3 × 6 (sets × reps). One line per set: kg and reps, separated by a space, not a comma (80 6). Dropset 5x 80 = 5 reps at 80 kg. A single number = bodyweight reps.',
  'info.importWorkouts.p2': 'A date line starts a new workout; a line like Push names it. Side-by-side sheets: copy one column group at a time.',

  'info.splitChoose.title': 'Choosing a split',
  'info.splitChoose.p1': 'Pick the number of days you can keep for months. With the same weekly sets, studies find full body, upper / lower and other splits give similar results.',
  'info.splitChoose.p2': 'Fewer days: full body. Four: upper / lower. Five or six: hybrid or push / pull / legs. Each muscle about twice a week is a simple default.',

  'info.splitRun.title': 'Running a split',
  'info.splitRun.p1': 'Do the sessions in order; Next up shows the one due. Rest a day before training the same muscles again.',
  'info.splitRun.p2': 'All sets at the top of the rep range? Add weight next time; otherwise add a rep. Swap an exercise for one with the same main muscle. Stalled? Take an easy week with half the sets.',

  'info.splitSets.title': 'Weekly sets',
  'info.splitSets.p1': 'Planned sets per muscle in a week. Direct (main mover) counts × {primary}, partial (assists) × {secondary}, as in your log.',
  'info.splitSets.p2': 'Weekly sets matter most; more tends to add a little more, with shrinking returns. Ranges are general guides, not prescriptions. Add sets only if you recover and keep progressing.',
};

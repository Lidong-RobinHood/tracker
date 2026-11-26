// Workout feature entry. Routes per docs/CONTRACT.md; views live in sibling modules.
import { mountHome } from './home.js';
import { mountSession } from './session.js';
import { mountLibrary, mountNewExercise, mountExerciseDetail } from './exercises.js';
import { mountRoutines, mountRoutineEdit } from './routines.js';
import { mountHistory, mountHistoryDetail } from './history.js';
import { mountRoutineProgress } from './routine-progress.js';
import { mountTargets } from './targets.js';
import { mountRecovery } from './recovery.js';
import { mountAnalytics } from './analytics.js';
import { mountStartingPoint } from './starting-point.js';
import { mountAnalysisHub } from './analysis-hub.js';

/** @type {import('../types.js').Route[]} */
export const routes = [
  { path: 'workout', titleKey: 'workout.route.workout', mount: mountHome },
  { path: 'workout/session/:id', titleKey: 'workout.route.workout', mount: mountSession },
  { path: 'workout/exercises', titleKey: 'workout.route.exercises', mount: mountLibrary },
  { path: 'workout/exercises/new', titleKey: 'workout.route.newExercise', mount: mountNewExercise },
  { path: 'workout/exercises/:id', titleKey: 'workout.route.exercise', mount: mountExerciseDetail },
  { path: 'workout/routines', titleKey: 'workout.route.routines', mount: mountRoutines },
  { path: 'workout/routines/:id', titleKey: 'workout.route.routine', mount: mountRoutineEdit },
  { path: 'workout/routines/:id/progress', titleKey: 'workout.route.routineProgress', mount: mountRoutineProgress },
  { path: 'workout/targets', titleKey: 'workout.route.targets', mount: mountTargets },
  { path: 'workout/recovery', titleKey: 'workout.route.recovery', mount: mountRecovery },
  { path: 'workout/history', titleKey: 'workout.route.history', mount: mountHistory },
  { path: 'workout/history/:id', titleKey: 'workout.route.workout', mount: mountHistoryDetail },
  { path: 'workout/summary/:id', titleKey: 'workout.route.summary', mount: mountAnalytics },
  { path: 'workout/analysis', titleKey: 'workout.route.analysis', mount: mountAnalysisHub },
  { path: 'workout/starting-point', titleKey: 'workout.route.startingPoint', mount: mountStartingPoint },
];

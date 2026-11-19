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
  { path: 'workout', title: 'Workout', mount: mountHome },
  { path: 'workout/session/:id', title: 'Workout', mount: mountSession },
  { path: 'workout/exercises', title: 'Exercises', mount: mountLibrary },
  { path: 'workout/exercises/new', title: 'New exercise', mount: mountNewExercise },
  { path: 'workout/exercises/:id', title: 'Exercise', mount: mountExerciseDetail },
  { path: 'workout/routines', title: 'Routines', mount: mountRoutines },
  { path: 'workout/routines/:id', title: 'Routine', mount: mountRoutineEdit },
  { path: 'workout/routines/:id/progress', title: 'Routine progress', mount: mountRoutineProgress },
  { path: 'workout/targets', title: 'Weekly set targets', mount: mountTargets },
  { path: 'workout/recovery', title: 'Muscle recovery', mount: mountRecovery },
  { path: 'workout/history', title: 'History', mount: mountHistory },
  { path: 'workout/history/:id', title: 'Workout', mount: mountHistoryDetail },
  { path: 'workout/summary/:id', title: 'Workout analysis', mount: mountAnalytics },
  { path: 'workout/analysis', title: 'Analysis', mount: mountAnalysisHub },
  { path: 'workout/starting-point', title: 'Starting point', mount: mountStartingPoint },
];

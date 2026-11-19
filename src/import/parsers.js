// The parsing functions run in the import worker (or on the main thread as a fallback).
import { parseWorkoutText } from '../core/import-workouts.js';
import { parseWeightText } from '../core/import-weights.js';
import { readTable, buildFoodRows } from '../core/import-food.js';

export const PARSERS = { parseWorkoutText, parseWeightText, readTable, buildFoodRows };

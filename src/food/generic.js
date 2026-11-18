// Bundled generic foods (USDA SR Legacy), loaded lazily on first search and kept in memory.
import { decodeGenericFoods, indexItem, search } from '../core/food-search.js';

let loading = null;

/** @returns {Promise<Array<{item: object, words: string[], len: number}>>} search index */
export function loadGeneric() {
  if (!loading) {
    loading = (async () => {
      const res = await fetch(new URL('../data/generic-foods.json', import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const foods = decodeGenericFoods(await res.json());
      return foods.map((f) => indexItem(f, f.name));
    })();
    loading.catch(() => { loading = null; }); // allow a retry (e.g. first use while offline)
  }
  return loading;
}

/** Search generic foods (loads the dataset on first call). */
export async function searchGeneric(query, limit = 25) {
  return search(query, await loadGeneric(), { limit });
}

import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, NORMAL_DAY_STEPS, type Site } from "../api";

export const useSitesStore = defineStore("sites", () => {
  const sites = ref<Site[]>([]);
  const loading = ref(false);
  const error = ref<string | null>(null);

  async function load(force = false) {
    if (loading.value || (sites.value.length && !force)) return;
    loading.value = true;
    error.value = null;
    try {
      sites.value = await api.sites();
    } catch (e) {
      error.value = (e as Error).message;
    } finally {
      loading.value = false;
    }
  }

  /** Earliest / latest local date any hall has data for. */
  const firstDate = computed(() => sites.value.map((s) => s.first_date).filter((d): d is string => !!d).sort()[0] ?? null);
  const lastDate = computed(() => sites.value.map((s) => s.last_date).filter((d): d is string => !!d).sort().at(-1) ?? null);

  /** Every day any hall has data for. If halls disagree on a day, an unusual step count wins, so it stays visible. */
  const days = computed(() => {
    const steps = new Map<string, number>();
    for (const d of sites.value.flatMap((s) => s.halls).flatMap((h) => h.days)) {
      if (!steps.has(d.date) || d.steps !== NORMAL_DAY_STEPS) steps.set(d.date, d.steps);
    }
    return [...steps].map(([date, steps]) => ({ date, steps })).sort((a, b) => a.date.localeCompare(b.date));
  });

  const hallName = (id: string) => sites.value.flatMap((s) => s.halls).find((h) => h.id === id)?.name;

  function reset() {
    sites.value = [];
    error.value = null;
  }

  return { sites, loading, error, load, reset, hallName, firstDate, lastDate, days };
});

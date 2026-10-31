import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { api, type Site } from "../api";

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

  const hallName = (id: string) => sites.value.flatMap((s) => s.halls).find((h) => h.id === id)?.name;

  function reset() {
    sites.value = [];
    error.value = null;
  }

  return { sites, loading, error, load, reset, hallName, firstDate, lastDate };
});

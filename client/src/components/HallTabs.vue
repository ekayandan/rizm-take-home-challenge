<script setup lang="ts">
/** The views of one hall around a date. The schedule choice carries over between them. */
import { computed } from "vue";
import { useRoute } from "vue-router";

const props = defineProps<{ hallId: string; date: string }>();
const route = useRoute();
const schedule = computed(() => (typeof route.query.schedule === "string" ? { schedule: route.query.schedule } : {}));
</script>

<template>
  <nav class="tabs" aria-label="Hall views">
    <RouterLink :to="{ name: 'hall-day', params: { hallId, date }, query: schedule }">Day</RouterLink>
    <RouterLink :to="{ name: 'hall-week', params: { hallId, date }, query: schedule }">Week</RouterLink>
    <RouterLink :to="{ name: 'hall-maintenance', params: { hallId }, query: { ...schedule, date: props.date } }">Maintenance</RouterLink>
  </nav>
</template>

<style scoped>
.tabs { display: flex; gap: 4px; border-bottom: 1px solid #c9ced4; margin-bottom: 12px; }
.tabs a { padding: 6px 14px; color: #6a737d; text-decoration: none; margin-bottom: -1px; }
.tabs a.router-link-active { color: #1d232a; font-weight: 600; border-bottom: 2px solid #1d232a; }
</style>

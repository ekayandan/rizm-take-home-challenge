<script setup lang="ts">
import { computed } from "vue";
import type { Shift } from "../api";

/** Shift hours, one per line, with shifts on the same weekdays sharing one label. */
const props = defineProps<{ shifts: Shift[] }>();

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const dayLabel = (d: number[]) =>
  d.length > 2 && d.at(-1)! - d[0] === d.length - 1
    ? `${WEEKDAYS[d[0]]}–${WEEKDAYS[d.at(-1)!]}`
    : d.map((i) => WEEKDAYS[i]).join(", ");

const groups = computed(() => {
  const byDays = new Map<string, string[]>();
  for (const s of props.shifts) {
    const label = dayLabel(s.weekdays);
    byDays.set(label, [...(byDays.get(label) ?? []), `${s.start}–${s.end}`]);
  }
  return [...byDays].map(([days, hours]) => ({ days, hours }));
});
</script>

<template>
  <div class="groups">
    <div v-for="group in groups" :key="group.days">
      <div class="muted days">{{ group.days }}</div>
      <div v-for="h in group.hours" :key="h">{{ h }}</div>
    </div>
  </div>
</template>

<style scoped>
.groups { display: flex; flex-direction: column; gap: 4px; white-space: nowrap; }
.days { font-size: 12px; }
</style>

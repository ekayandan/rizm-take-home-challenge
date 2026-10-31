<script lang="ts">
export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

const GAP = 6;
const EDGE = 8;

/** Below the anchor, or above when it only fits there; always kept inside the viewport. */
export function placeTooltip(anchor: Box, tip: { width: number; height: number }, viewport: { width: number; height: number }) {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - tip.height;
  const top = below + tip.height > viewport.height - EDGE && above >= EDGE ? above : below;
  const left = Math.max(EDGE, Math.min(anchor.left, viewport.width - EDGE - tip.width));
  return { left, top };
}

let nextId = 0;
</script>

<script setup lang="ts">
/**
 * A "?" next to a term that explains it on the spot. Works with a mouse (hover), the keyboard
 * (focus, Escape to close) and touch (tap, tap elsewhere to close), since the control room tablet
 * has no hover. The text is teleported to the body so scrolling tables and cards don't clip it.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { GLOSSARY, type GlossaryTerm } from "../glossary";

const props = defineProps<{ term: GlossaryTerm }>();

const entry = computed(() => GLOSSARY[props.term]);
const id = `term-help-${++nextId}`;
const button = ref<HTMLButtonElement | null>(null);
const tip = ref<HTMLDivElement | null>(null);
const open = ref(false);
const position = ref({ left: 0, top: 0 });

let closeTimer: ReturnType<typeof setTimeout> | undefined;
const show = () => {
  clearTimeout(closeTimer);
  open.value = true;
};
const hide = () => {
  clearTimeout(closeTimer);
  open.value = false;
};
/** A short delay, so the pointer can cross from the button onto the text without closing it. */
const hideSoon = () => {
  clearTimeout(closeTimer);
  if (document.activeElement !== button.value) closeTimer = setTimeout(hide, 120);
};

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === "Escape") hide();
};
const onPointerDown = (e: PointerEvent) => {
  const target = e.target as Node;
  if (!button.value?.contains(target) && !tip.value?.contains(target)) hide();
};

function place() {
  if (!button.value || !tip.value) return;
  const a = button.value.getBoundingClientRect();
  const t = tip.value.getBoundingClientRect();
  position.value = placeTooltip(a, t, { width: window.innerWidth, height: window.innerHeight });
}

/** Scrolling moves the text along instead of closing it: tabbing to an off-screen "?" scrolls too. */
function listen() {
  document.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("scroll", place, true);
  window.addEventListener("resize", place);
}
function unlisten() {
  document.removeEventListener("keydown", onKeydown);
  document.removeEventListener("pointerdown", onPointerDown);
  window.removeEventListener("scroll", place, true);
  window.removeEventListener("resize", place);
}

watch(open, async (isOpen) => {
  if (!isOpen) return unlisten();
  listen();
  await nextTick();
  place();
});

onBeforeUnmount(() => {
  clearTimeout(closeTimer);
  unlisten();
});
</script>

<template>
  <span class="term-help">
    <slot /><button
      ref="button"
      type="button"
      class="term-help-button"
      :aria-label="`What is ${entry.title}?`"
      :aria-expanded="open"
      :aria-describedby="open ? id : undefined"
      @pointerenter="show"
      @pointerleave="hideSoon"
      @focus="show"
      @blur="hide"
      @click="show"
    ><span aria-hidden="true">?</span></button>
    <Teleport to="body">
      <div
        v-if="open"
        :id="id"
        ref="tip"
        class="term-help-tip"
        role="tooltip"
        :style="{ left: `${position.left}px`, top: `${position.top}px` }"
        @pointerenter="show"
        @pointerleave="hideSoon"
      >
        <strong>{{ entry.title }}</strong>
        {{ entry.text }}
      </div>
    </Teleport>
  </span>
</template>

<style scoped>
.term-help { white-space: normal; }
/* A 16 px circle in a 24 px target, so it can be hit on the tablet; the margin keeps rows from growing. */
.term-help-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  margin: -4px 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: none;
  vertical-align: middle;
  cursor: help;
}
.term-help-button span {
  box-sizing: border-box;
  width: 16px;
  height: 16px;
  border: 1px solid #8a939c;
  border-radius: 50%;
  background: #fff;
  color: #4a535c;
  font: 600 11px/14px system-ui, sans-serif;
  text-align: center;
}
.term-help-button:hover span, .term-help-button[aria-expanded="true"] span { border-color: #1d232a; background: #eef0f3; color: #1d232a; }
.term-help-button:focus-visible { outline: 2px solid #1c7ed6; outline-offset: -2px; }
.term-help-tip {
  position: fixed;
  z-index: 100;
  width: min(300px, calc(100vw - 16px));
  box-sizing: border-box;
  padding: 8px 10px;
  border-radius: 6px;
  background: #1d232a;
  color: #fff;
  font: 400 13px/1.4 system-ui, sans-serif;
  text-align: left;
  white-space: normal;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
}
.term-help-tip strong { display: block; margin-bottom: 2px; }
</style>

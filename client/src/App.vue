<script setup lang="ts">
import { ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { useSitesStore } from "./stores/sites";

const auth = useAuthStore();
const store = useSitesStore();
const router = useRouter();

// Load the sites whenever someone logs in (the list depends on the user's site assignments).
watch(() => auth.user?.id, (id) => { if (id) store.load(true); }, { immediate: true });

const retrying = ref(false);

/** Asks about the session again, then lets the router guard decide where this page belongs. */
async function retry() {
  retrying.value = true;
  await auth.ensureChecked();
  retrying.value = false;
  if (!auth.unavailable) await router.replace({ path: router.currentRoute.value.fullPath, force: true });
}

async function logout() {
  await auth.logout().catch(() => {});
  await router.replace({ name: "login" });
}
</script>

<template>
  <div v-if="auth.unavailable" class="outage">
    <section class="card">
      <h1>Hall HVAC</h1>
      <p>The service is not available right now, so we can't check your login. You don't need to do anything else; try again in a moment.</p>
      <button type="button" class="retry" :disabled="retrying" @click="retry">{{ retrying ? "Trying…" : "Try again" }}</button>
    </section>
  </div>
  <RouterView v-else-if="!auth.loggedIn" />
  <div v-else class="layout">
    <aside>
      <RouterLink to="/" class="brand">Hall HVAC</RouterLink>
      <p v-if="store.loading" class="muted">Loading…</p>
      <p v-else-if="store.error" class="error">{{ store.error }}</p>
      <nav v-for="site in store.sites" :key="site.id">
        <h2>{{ site.name }}</h2>
        <RouterLink v-for="hall in site.halls" :key="hall.id" :to="{ name: 'hall', params: { hallId: hall.id } }">
          {{ hall.name }}
        </RouterLink>
      </nav>
      <nav>
        <RouterLink :to="{ name: 'interventions' }">Intervention history</RouterLink>
      </nav>
      <div class="account">
        <div>{{ auth.user!.name }}</div>
        <div class="role">{{ auth.user!.role }}</div>
        <button type="button" @click="logout">Log out</button>
      </div>
    </aside>
    <main><RouterView /></main>
  </div>
</template>

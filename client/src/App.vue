<script setup lang="ts">
import { watch } from "vue";
import { useRouter } from "vue-router";
import { useAuthStore } from "./stores/auth";
import { useSitesStore } from "./stores/sites";

const auth = useAuthStore();
const store = useSitesStore();
const router = useRouter();

// Load the sites whenever someone logs in (the list depends on the user's site assignments).
watch(() => auth.user?.id, (id) => { if (id) store.load(true); }, { immediate: true });

async function logout() {
  await auth.logout().catch(() => {});
  await router.replace({ name: "login" });
}
</script>

<template>
  <RouterView v-if="!auth.loggedIn" />
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

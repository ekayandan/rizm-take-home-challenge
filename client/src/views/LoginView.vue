<script setup lang="ts">
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../stores/auth";

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const busy = ref(false);

/** Only follow same-app paths, never an absolute URL from the query string. */
const target = () => {
  const r = route.query.redirect;
  return typeof r === "string" && r.startsWith("/") && !r.startsWith("//") ? r : "/";
};

async function submit() {
  error.value = null;
  busy.value = true;
  try {
    await auth.login(email.value, password.value);
    await router.replace(target());
  } catch (e) {
    error.value = (e as Error).message;
    password.value = "";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <form class="card login" @submit.prevent="submit">
      <h1>Hall HVAC</h1>
      <p class="muted">Sign in to continue.</p>
      <label>
        Email
        <input v-model="email" type="email" name="email" autocomplete="username" required autofocus />
      </label>
      <label>
        Password
        <input v-model="password" type="password" name="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="error" role="alert">{{ error }}</p>
      <button type="submit" :disabled="busy">{{ busy ? "Signing in…" : "Sign in" }}</button>
    </form>
  </div>
</template>

<style scoped>
.login-page { min-height: 100vh; display: grid; place-items: center; padding: 16px; box-sizing: border-box; }
.login { width: 100%; max-width: 340px; display: flex; flex-direction: column; gap: 12px; }
.login h1 { margin: 0; }
.login p { margin: 0; }
label { display: flex; flex-direction: column; gap: 4px; font-size: 14px; }
input { padding: 8px; font: inherit; border: 1px solid #c8cdd3; border-radius: 6px; }
button { padding: 8px; font: inherit; font-weight: 600; border: 0; border-radius: 6px; background: #1d232a; color: #fff; cursor: pointer; }
button:disabled { opacity: .6; cursor: default; }
</style>

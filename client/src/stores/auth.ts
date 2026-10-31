import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authApi, Unauthorized, type User } from "../api";
import { useSitesStore } from "./sites";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  /** True once we asked the server whether a session exists. */
  const checked = ref(false);
  let pending: Promise<void> | null = null;

  const loggedIn = computed(() => user.value !== null);

  /** Asks the server for the current session once; later calls reuse the answer. */
  function ensureChecked(): Promise<void> {
    if (checked.value) return Promise.resolve();
    pending ??= authApi
      .me()
      .then((u) => { user.value = u; })
      .catch((e) => { if (!(e instanceof Unauthorized)) console.error(e); user.value = null; })
      .finally(() => { checked.value = true; pending = null; });
    return pending;
  }

  async function login(email: string, password: string) {
    user.value = await authApi.login(email, password);
    checked.value = true;
    useSitesStore().reset();
  }

  /** Forgets the user locally (also used when the server says the session is gone). */
  function clear() {
    user.value = null;
    checked.value = true;
    useSitesStore().reset();
  }

  async function logout() {
    try {
      await authApi.logout();
    } finally {
      clear();
    }
  }

  return { user, checked, loggedIn, ensureChecked, login, logout, clear };
});

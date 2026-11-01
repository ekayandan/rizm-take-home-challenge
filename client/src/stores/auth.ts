import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { authApi, Unauthorized, type User } from "../api";
import { useSitesStore } from "./sites";

export const useAuthStore = defineStore("auth", () => {
  const user = ref<User | null>(null);
  /** True once we asked the server whether a session exists. */
  const checked = ref(false);
  /** The last session check failed for a reason other than 401; the next check asks again. */
  const unavailable = ref(false);
  /** A logged-in session was lost; the login page explains why the person is there. */
  const sessionExpired = ref(false);
  let pending: Promise<void> | null = null;

  const loggedIn = computed(() => user.value !== null);

  /** Asks the server for the current session once; later calls reuse the answer. */
  function ensureChecked(): Promise<void> {
    if (checked.value) return Promise.resolve();
    pending ??= authApi
      .me()
      .then((u) => { user.value = u; unavailable.value = false; checked.value = true; })
      .catch((e) => {
        user.value = null;
        unavailable.value = !(e instanceof Unauthorized);
        if (unavailable.value) console.error(e);
        else checked.value = true;
      })
      .finally(() => { pending = null; });
    return pending;
  }

  async function login(email: string, password: string) {
    user.value = await authApi.login(email, password);
    checked.value = true;
    unavailable.value = false;
    sessionExpired.value = false;
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
      // A data request may have answered 401 while the logout was on its way.
      sessionExpired.value = false;
    }
  }

  return { user, checked, unavailable, sessionExpired, loggedIn, ensureChecked, login, logout, clear };
});

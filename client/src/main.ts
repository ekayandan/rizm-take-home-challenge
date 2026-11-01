import { createApp } from "vue";
import { createPinia } from "pinia";
import App from "./App.vue";
import { router } from "./router";
import { setUnauthorizedHandler } from "./api";
import { useAuthStore } from "./stores/auth";
import { watchLongTasks } from "./perf";
import "./style.css";

watchLongTasks();

const app = createApp(App).use(createPinia()).use(router);

// A data request answered 401 (session expired or logged out elsewhere): back to the login page.
setUnauthorizedHandler(() => {
  const auth = useAuthStore();
  if (!auth.loggedIn) return;
  auth.clear();
  auth.sessionExpired = true;
  const current = router.currentRoute.value;
  if (current.name !== "login") router.replace({ name: "login", query: { redirect: current.fullPath } });
});

app.mount("#app");

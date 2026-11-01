import { createRouter, createWebHistory } from "vue-router";
import HomeView from "./views/HomeView.vue";
import HallView from "./views/HallView.vue";
import HallDayView from "./views/HallDayView.vue";
import HallWeekView from "./views/HallWeekView.vue";
import InterventionsView from "./views/InterventionsView.vue";
import LoginView from "./views/LoginView.vue";
import { useAuthStore } from "./stores/auth";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/login", name: "login", component: LoginView, meta: { public: true } },
    { path: "/", name: "home", component: HomeView },
    { path: "/halls/:hallId", name: "hall", component: HallView, props: true },
    { path: "/halls/:hallId/days/:date", name: "hall-day", component: HallDayView, props: true },
    { path: "/halls/:hallId/weeks/:date", name: "hall-week", component: HallWeekView, props: true },
    { path: "/interventions", name: "interventions", component: InterventionsView },
    { path: "/:pathMatch(.*)*", redirect: "/" },
  ],
});

// Every page except /login needs a session; the API enforces the same on its side.
router.beforeEach(async (to) => {
  const auth = useAuthStore();
  await auth.ensureChecked();
  if (to.meta.public) return auth.loggedIn && to.name === "login" ? { path: "/" } : true;
  // Not known to be logged out: App shows the outage with a retry instead of the page.
  if (auth.unavailable) return true;
  if (!auth.loggedIn) return { name: "login", query: to.fullPath === "/" ? {} : { redirect: to.fullPath } };
  return true;
});

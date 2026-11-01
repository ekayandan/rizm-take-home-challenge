/** Issue 7: failures reach people in plain words, and an outage isn't a logout. IDs are in task-7.md. */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { api, authApi, Unauthorized } from "../src/api";
import { useAuthStore } from "../src/stores/auth";
import LoginView from "../src/views/LoginView.vue";
import { BAD_GATEWAY, settle, stubFetch, testRouter } from "./helpers";

beforeEach(() => setActivePinia(createPinia()));
afterEach(() => vi.unstubAllGlobals());

const failure = (p: Promise<unknown>) => p.then(() => { throw new Error("expected a failure"); }, (e: Error) => e);

describe("error messages", () => {
  test("P14: a network failure says the server can't be reached", async () => {
    stubFetch({ "GET /sites": "network-error" });
    const e = await failure(api.sites());
    expect(e.message).not.toMatch(/failed to fetch/i);
    expect(e.message).toMatch(/reach|connection/i);
  });

  test("P19, P20, P22: a 502 from the proxy says the service is unavailable", async () => {
    stubFetch({ "GET /sites": BAD_GATEWAY });
    const e = await failure(api.sites());
    expect(e.message).not.toMatch(/502|bad gateway/i);
    expect(e.message).toMatch(/not reachable|not available|unavailable/i);
  });

  test("C3: a bare 500 is described in plain words", async () => {
    stubFetch({ "GET /sites": { status: 500, body: { error: "internal error" } } });
    const e = await failure(api.sites());
    expect(e.message).not.toMatch(/^internal error$|500/i);
    expect(e.message).toMatch(/went wrong|problem/i);
  });

  test("a validation message from the server is kept", async () => {
    stubFetch({ "POST /halls/h/maintenance": { status: 400, body: { error: "'end' must be after 'start'" } } });
    const e = await failure(api.addMaintenance("h", { asset: "fan", start: "a", end: "b" }));
    expect(e.message).toBe("'end' must be after 'start'");
  });

  test("a wrong password is still reported as such", async () => {
    stubFetch({ "POST /auth/login": { status: 401, body: { error: "wrong email or password" } } });
    const e = await failure(authApi.login("a@b.c", "x"));
    expect(e).toBeInstanceOf(Unauthorized);
    expect(e.message).toBe("wrong email or password");
  });
});

describe("P21: session check during an outage", () => {
  test("a failed check is asked again instead of counting as logged out", async () => {
    const user = { id: "u", name: "U", email: "u@x", role: "admin", sites: [] };
    stubFetch({ "GET /auth/me": [BAD_GATEWAY, { body: { user } }] });
    const auth = useAuthStore();
    await auth.ensureChecked();
    expect(auth.unavailable).toBe(true);
    await auth.ensureChecked();
    expect(auth.user?.id).toBe("u");
    expect(auth.unavailable).toBe(false);
  });

  test("a 401 still means logged out, not unavailable", async () => {
    stubFetch({ "GET /auth/me": { status: 401, body: { error: "login required" } } });
    const auth = useAuthStore();
    await auth.ensureChecked();
    expect(auth.loggedIn).toBe(false);
    expect(auth.unavailable).toBe(false);
  });

  test("the guarded router does not send people to login during an outage", async () => {
    stubFetch({ "GET /auth/me": BAD_GATEWAY });
    const { router } = await import("../src/router");
    await router.push("/halls/halle-a");
    expect(router.currentRoute.value.name).not.toBe("login");
  });

  test("the app says the service is unavailable, with a retry", async () => {
    stubFetch({ "GET /auth/me": BAD_GATEWAY });
    const { default: App } = await import("../src/App.vue");
    const router = testRouter("/");
    const auth = useAuthStore();
    await auth.ensureChecked();
    const w = mount(App, { global: { plugins: [router] } });
    await settle();
    expect(w.text()).toMatch(/unavailable|not available/i);
    expect(w.findAll("button").some((b) => /try again|retry/i.test(b.text()))).toBe(true);
    w.unmount();
  });
});

describe("P18: session expiry", () => {
  test("the login page explains an expired session", async () => {
    stubFetch({});
    const auth = useAuthStore();
    auth.sessionExpired = true;
    const w = mount(LoginView, { global: { plugins: [testRouter("/login")] } });
    expect(w.text()).toMatch(/session.*expired/i);
    expect(w.text()).toMatch(/not saved|sign in again/i);
    w.unmount();
  });

  test("a plain visit to login shows no such notice", () => {
    stubFetch({});
    const w = mount(LoginView, { global: { plugins: [testRouter("/login")] } });
    expect(w.text()).not.toMatch(/expired/i);
    w.unmount();
  });
});

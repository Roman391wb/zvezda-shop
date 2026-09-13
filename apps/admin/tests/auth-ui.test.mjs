import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { AUTH_STATE, applyAuthState, loginErrorMessage, setLoginPending } from "../public/auth-state.mjs";

const nodes = () => ({ checking: { hidden: false }, login: { hidden: false }, app: { hidden: false } });

test("auth state gates login and shell exclusively", () => {
  for (const [state, expected] of [[AUTH_STATE.CHECKING, [false, true, true]], [AUTH_STATE.UNAUTHENTICATED, [true, false, true]], [AUTH_STATE.AUTHENTICATED, [true, true, false]]]) {
    const view = nodes();
    applyAuthState(state, view);
    assert.deepEqual([view.checking.hidden, view.login.hidden, view.app.hidden], expected);
  }
});

test("login errors are safe and actionable", () => {
  assert.equal(loginErrorMessage({ status: 401 }), "Неверный логин или пароль");
  assert.equal(loginErrorMessage({ network: true }), "Не удалось связаться с сервером. Попробуйте ещё раз.");
  assert.equal(loginErrorMessage({ status: 503 }), "Сервис временно недоступен.");
});

test("login pending state disables and restores the submit button", () => {
  const button = { disabled: false, textContent: "Войти", dataset: {} };
  setLoginPending(button, true);
  assert.equal(button.disabled, true);
  assert.equal(button.textContent, "Входим…");
  setLoginPending(button, false);
  assert.equal(button.disabled, false);
  assert.equal(button.textContent, "Войти");
});

test("hidden state has an author-level display override", async () => {
  const css = await readFile(new URL("../public/auth-states.css", import.meta.url), "utf8");
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

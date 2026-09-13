export const AUTH_STATE = Object.freeze({
  CHECKING: "AUTH_CHECKING",
  UNAUTHENTICATED: "UNAUTHENTICATED",
  AUTHENTICATED: "AUTHENTICATED"
});

export function applyAuthState(state, nodes) {
  nodes.checking.hidden = state !== AUTH_STATE.CHECKING;
  nodes.login.hidden = state !== AUTH_STATE.UNAUTHENTICATED;
  nodes.app.hidden = state !== AUTH_STATE.AUTHENTICATED;
  return state;
}

export function loginErrorMessage(error) {
  if (error?.status === 401) return "Неверный логин или пароль";
  if (error?.status === 403) return "Недостаточно прав для входа.";
  if (error?.network || error?.code === "network_error" || error?.message === "Нет соединения с Admin API.") return "Не удалось связаться с сервером. Попробуйте ещё раз.";
  if (Number(error?.status) >= 500) return "Сервис временно недоступен.";
  if (error?.code === "session_verification_failed") return "Не удалось подтвердить вход. Попробуйте ещё раз.";
  return "Не удалось выполнить вход. Попробуйте ещё раз.";
}

export function setLoginPending(button, pending) {
  const idleLabel = button.dataset.idleLabel || button.textContent;
  button.dataset.idleLabel = idleLabel;
  button.disabled = pending;
  button.textContent = pending ? "Входим…" : idleLabel;
}

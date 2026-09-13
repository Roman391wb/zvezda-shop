import { AppError } from "./errors";

const encoder = new TextEncoder();

export function requestId(request: Request): string {
  const received = request.headers.get("X-Request-Id");
  return received && /^[A-Za-z0-9._-]{8,128}$/.test(received) ? received : crypto.randomUUID();
}

export function json(value: unknown, status = 200, requestIdValue?: string, headers?: HeadersInit): Response {
  const result = new Headers(headers);
  result.set("Content-Type", "application/json; charset=utf-8");
  result.set("Cache-Control", "no-store");
  result.set("X-Content-Type-Options", "nosniff");
  if (requestIdValue) result.set("X-Request-Id", requestIdValue);
  const body = status === 204 || status === 205 || status === 304 ? null : JSON.stringify(value);
  return new Response(body, { status, headers: result });
}

export function errorResponse(error: unknown, requestIdValue: string): Response {
  if (error instanceof AppError) return json({ error: { code: error.code, detail: error.detail }, request_id: requestIdValue }, error.status, requestIdValue, error.headers);
  console.error(JSON.stringify({ event: "admin.unhandled_error", request_id: requestIdValue, error: error instanceof Error ? error.name : "unknown" }));
  return json({ error: { code: "internal_error", detail: "Внутренняя ошибка сервиса" }, request_id: requestIdValue }, 500, requestIdValue);
}

export async function readJson<T>(request: Request): Promise<T> {
  const contentType = request.headers.get("Content-Type") ?? "";
  if (!contentType.toLowerCase().startsWith("application/json")) throw new AppError(415, "unsupported_media_type", "Ожидается application/json");
  const body = await request.text();
  if (encoder.encode(body).byteLength > 16_384) throw new AppError(413, "payload_too_large", "Слишком большой запрос");
  try { return JSON.parse(body) as T; } catch { throw new AppError(400, "invalid_json", "Некорректный JSON"); }
}

export function parseCookies(request: Request): Map<string, string> {
  const result = new Map<string, string>();
  for (const part of (request.headers.get("Cookie") ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0) result.set(part.slice(0, index).trim(), part.slice(index + 1).trim());
  }
  return result;
}

export function apiCookie(value: string, secure: boolean, maxAge = 43_200): string {
  return `za_admin_session=${value}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function expiredApiCookie(secure: boolean): string {
  return apiCookie("", secure, 0);
}

export function csrfCookie(value: string, secure: boolean, maxAge = 43_200): string {
  return `za_admin_csrf=${value}; Path=/api/admin; SameSite=Strict; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
}

export function expiredCsrfCookie(secure: boolean): string {
  return csrfCookie("", secure, 0);
}

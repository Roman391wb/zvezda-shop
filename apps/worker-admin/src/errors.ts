export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string,
    readonly headers?: HeadersInit
  ) {
    super(detail);
  }
}

export const unauthorized = () => new AppError(401, "unauthenticated", "Требуется авторизация администратора");
export const forbidden = () => new AppError(403, "forbidden", "Недостаточно прав");

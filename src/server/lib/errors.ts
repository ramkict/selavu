export type FieldErrors = Record<string, string[]>;

export class DomainError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fieldErrors?: FieldErrors,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export const notFound = (what: string) => new DomainError(404, "NOT_FOUND", `${what} was not found.`);

export const conflict = (message: string, fieldErrors?: FieldErrors) =>
  new DomainError(409, "CONFLICT", message, fieldErrors);

export const semantic = (message: string, fieldErrors?: FieldErrors) =>
  new DomainError(422, "VALIDATION_ERROR", message, fieldErrors ?? { _form: [message] });

export const staleVersion = () =>
  conflict("This record was changed by another update. Reload and reapply your changes.");

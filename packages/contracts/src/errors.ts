// Shared failure vocabulary for registries and boundary validation.
// Call sites embed name@version (or from→to) in the message so logs stay
// greppable without leaking secrets; no retry or recovery policy lives here.
export type ContractErrorCode =
  | "DUPLICATE_REGISTRATION"
  | "NOT_FOUND"
  | "INCOMPATIBLE_VERSION"
  | "VALIDATION_FAILED"
  | "LIFECYCLE_VIOLATION";

export class ContractError extends Error {
  readonly code: ContractErrorCode;

  constructor(code: ContractErrorCode, message: string) {
    super(message);
    this.name = "ContractError";
    this.code = code;
  }
}

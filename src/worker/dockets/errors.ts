export class ServiceError extends Error {
  constructor(public status: 400 | 403 | 404 | 409 | 502 | 503, message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

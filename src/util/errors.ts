/** Agent-facing error: `code` is UPPER_SNAKE (BAD_INPUT, CHROME_NOT_FOUND, RENDER_FAILED, RENDER_TIMEOUT, INTERNAL), `message` ends with the fix. */
export class NbError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "NbError";
  }
}

export class MessagingTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MessagingTimeoutError';
  }
}

export class LLMKitError extends Error {
  constructor(
    message: string,
    public code: ErrorCode,
    public statusCode: number = 500,
    public provider?: string
  ) {
    super(message);
    this.name = 'LLMKitError';
  }
}

export class BudgetExceededError extends LLMKitError {
  constructor(
    public budgetId: string,
    public limitCents: number,
    public usedCents: number
  ) {
    super(
      `Budget exceeded: $${(usedCents / 100).toFixed(2)} used of $${(limitCents / 100).toFixed(2)} limit. Increase your budget in the dashboard settings.`,
      'BUDGET_EXCEEDED',
      402
    );
    this.name = 'BudgetExceededError';
  }
}

export class ProviderError extends LLMKitError {
  constructor(
    message: string,
    provider: string,
    public upstreamStatus?: number
  ) {
    super(message, 'PROVIDER_ERROR', 502, provider);
    this.name = 'ProviderError';
  }
}

export class AllProvidersFailedError extends LLMKitError {
  constructor(public errors: ProviderError[]) {
    const summary = errors
      .map((e) => `${e.provider}: ${e.message}`)
      .join('; ');
    super(`All providers failed: ${summary}`, 'ALL_PROVIDERS_FAILED', 503);
    this.name = 'AllProvidersFailedError';
  }
}

export class AuthError extends LLMKitError {
  constructor(message = 'Invalid or missing API key') {
    super(message, 'AUTH_ERROR', 401);
    this.name = 'AuthError';
  }
}

export class ValidationError extends LLMKitError {
  constructor(message: string) {
    super(message, 'INVALID_REQUEST', 400);
    this.name = 'ValidationError';
  }
}

export class RateLimitError extends LLMKitError {
  constructor(
    public retryAfterMs?: number,
    provider?: string
  ) {
    super('Rate limit exceeded', 'RATE_LIMIT', 429, provider);
    this.name = 'RateLimitError';
  }
}

export type ErrorCode =
  | 'BUDGET_EXCEEDED'
  | 'PROVIDER_ERROR'
  | 'ALL_PROVIDERS_FAILED'
  | 'AUTH_ERROR'
  | 'RATE_LIMIT'
  | 'INVALID_REQUEST'
  | 'INTERNAL_ERROR';

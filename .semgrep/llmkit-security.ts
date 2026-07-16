declare function trackRequest(value: unknown): void;
declare const apiKey: string;
declare const apiKeyId: string;
declare const provider: string;

// ruleid: llmkit.no-plaintext-api-key-in-track-request
trackRequest({ apiKey });

// ruleid: llmkit.no-plaintext-api-key-console
console.log({ apiKey });

// ok: llmkit.no-plaintext-api-key-in-track-request
trackRequest({ apiKeyId });

// ok: llmkit.no-plaintext-api-key-console
console.log({ provider, apiKeyId });

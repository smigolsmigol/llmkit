// AES-256-GCM encrypt/decrypt via WebCrypto (native to CF Workers)
// AAD (Additional Authenticated Data) binds ciphertext to a context string
// (e.g. "user_123:openai") so ciphertext can't be swapped between rows.

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

export async function encrypt(
  plaintext: string,
  keyBase64: string,
  context?: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await importKey(keyBase64);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);

  const algo = {
    name: 'AES-GCM' as const,
    iv,
    ...(context ? { additionalData: new TextEncoder().encode(context) } : {}),
  };
  const encrypted = await crypto.subtle.encrypt(algo, key, encoded);
  return { ciphertext: toBase64(encrypted), iv: toBase64(iv.buffer) };
}

export async function decrypt(
  ciphertext: string,
  iv: string,
  keyBase64: string,
  context?: string,
): Promise<string> {
  const key = await importKey(keyBase64);
  const ivBytes = fromBase64(iv);

  const algo = {
    name: 'AES-GCM' as const,
    iv: ivBytes,
    ...(context ? { additionalData: new TextEncoder().encode(context) } : {}),
  };
  const decrypted = await crypto.subtle.decrypt(algo, key, fromBase64(ciphertext));
  return new TextDecoder().decode(decrypted);
}

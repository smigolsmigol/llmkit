export const STAGING_WORKER_NAME = 'llmkit-proxy-staging';
export const STAGING_SECRET_NAMES = [
  'ENCRYPTION_KEY',
  'STAGING_PROOF_TOKEN',
  'STAGING_SUPABASE_PROJECT_REF',
  'SUPABASE_KEY',
  'SUPABASE_URL',
];

const PROJECT_REF_PATTERN = /^[a-z0-9]{20}$/;

function unquote(value) {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

export function parseStagingSecrets(source) {
  const text = String(source).replace(/^\uFEFF/, '');
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('Staging JSON secrets must be an object.');
    }
    return new Map(Object.entries(parsed).map(([name, value]) => {
      if (typeof value !== 'string') throw new Error('Staging JSON secret values must be strings.');
      return [name, value];
    }));
  } catch (error) {
    if (error instanceof SyntaxError) {
      const secrets = new Map();
      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim().replace(/^export\s+/, '');
        if (!line || line.startsWith('#')) continue;
        const separator = line.indexOf('=');
        if (separator <= 0) throw new Error('Staging secrets file contains a malformed line.');
        const name = line.slice(0, separator).trim();
        if (secrets.has(name)) throw new Error('Staging secrets file contains a duplicate name.');
        secrets.set(name, unquote(line.slice(separator + 1).trim()));
      }
      return secrets;
    }
    throw error;
  }
}

export function validateStagingDatabaseBinding(secrets, stagingProjectRef, productionProjectRef) {
  if (!PROJECT_REF_PATTERN.test(stagingProjectRef || '')) {
    throw new Error('Staging database project ref must be exactly 20 lowercase letters or digits.');
  }
  if (!PROJECT_REF_PATTERN.test(productionProjectRef || '')) {
    throw new Error('Production database project ref must be exactly 20 lowercase letters or digits.');
  }
  if (stagingProjectRef === productionProjectRef) {
    throw new Error('Staging database project ref must differ from production.');
  }
  if (secrets.get('STAGING_SUPABASE_PROJECT_REF') !== stagingProjectRef) {
    throw new Error('Staging secrets project ref does not match the approved staging database.');
  }
  if (secrets.get('SUPABASE_URL') !== `https://${stagingProjectRef}.supabase.co`) {
    throw new Error('Staging Supabase URL does not match the approved staging database.');
  }
}

export function stagingDeployApproval(accountId, stagingProjectRef) {
  return `staging:${STAGING_WORKER_NAME}:account:${accountId}:db:${stagingProjectRef}`;
}

export function isStagingWorkerMissing(output) {
  const text = String(output);
  const missingCode = /\[code:\s*(?:10007|10090)\]/i.test(text)
    || /"code"\s*:\s*(?:10007|10090)/i.test(text);
  const exactRenderedError = text.includes(`Worker "${STAGING_WORKER_NAME}" not found.`);
  return missingCode || exactRenderedError;
}

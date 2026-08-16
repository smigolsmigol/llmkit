import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const OFFICIAL_META = 'io.modelcontextprotocol.registry/official';

export function assertRegistryMatches(payload, expectedVersion, serverName, packageName) {
  if (!expectedVersion || !serverName || !packageName) {
    throw new Error('expected version, server name, and package name are required');
  }

  const records = payload?.server ? [payload] : [];
  const latest = records.filter(
    (record) =>
      record?.server?.name === serverName && record?._meta?.[OFFICIAL_META]?.isLatest === true,
  );
  if (latest.length !== 1) {
    throw new Error(`expected one latest ${serverName} record, found ${latest.length}`);
  }

  const latestRecord = latest[0];
  const status = latestRecord._meta?.[OFFICIAL_META]?.status;
  if (status !== 'active') {
    throw new Error(`latest record status ${status ?? 'missing'} != active`);
  }

  const server = latestRecord.server;
  const packageRecords = (server.packages ?? []).filter(
    (candidate) =>
      candidate?.identifier === packageName &&
      candidate?.registryType === 'npm' &&
      candidate?.transport?.type === 'stdio',
  );
  if (packageRecords.length !== 1) {
    throw new Error(
      `expected one npm stdio ${packageName} package, found ${packageRecords.length}`,
    );
  }
  const packageRecord = packageRecords[0];
  if (server.version !== expectedVersion) {
    throw new Error(`server version ${server.version ?? 'missing'} != npm ${expectedVersion}`);
  }
  if (packageRecord.version !== expectedVersion) {
    throw new Error(
      `package version ${packageRecord.version ?? 'missing'} != npm ${expectedVersion}`,
    );
  }

  return { serverVersion: server.version, packageVersion: packageRecord.version };
}

async function main() {
  const [expectedVersion, serverName, packageName] = process.argv.slice(2);
  const raw = readFileSync(0, 'utf8');
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw new Error('response was not valid JSON');
  }

  const result = assertRegistryMatches(payload, expectedVersion, serverName, packageName);
  process.stdout.write(`MCP Registry ${serverName} matches npm ${result.packageVersion}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

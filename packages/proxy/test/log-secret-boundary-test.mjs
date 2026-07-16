import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const srcRoot = resolve(import.meta.dirname, '..', 'src');
const secretNames = new Set([
  'apiKey',
  'serviceKey',
  'providerKey',
  'SUPABASE_KEY',
  'TELEGRAM_BOT_TOKEN',
  'ENCRYPTION_KEY',
]);

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

function isConsoleCall(node) {
  return ts.isCallExpression(node)
    && ts.isPropertyAccessExpression(node.expression)
    && ts.isIdentifier(node.expression.expression)
    && node.expression.expression.text === 'console';
}

function containsSecretReference(node) {
  let found = false;
  function visit(child) {
    if (ts.isIdentifier(child) && secretNames.has(child.text)) {
      found = true;
      return;
    }
    ts.forEachChild(child, visit);
  }
  visit(node);
  return found;
}

function hasApiKeyProperty(node) {
  if (!ts.isCallExpression(node)
      || !ts.isIdentifier(node.expression)
      || node.expression.text !== 'trackRequest'
      || !node.arguments.length
      || !ts.isObjectLiteralExpression(node.arguments[0])) {
    return false;
  }
  return node.arguments[0].properties.some((property) => {
    if (!('name' in property) || !property.name) return false;
    return (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name))
      && property.name.text === 'apiKey';
  });
}

function scanSource(sourceText, path) {
  const violations = [];
  const source = ts.createSourceFile(path, sourceText, ts.ScriptTarget.Latest, true);

  function visit(node) {
    if (isConsoleCall(node) && node.arguments.some(containsSecretReference)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      violations.push(`${path}:${line} sends a secret-bearing identifier to console.*`);
    }
    if (hasApiKeyProperty(node)) {
      const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
      violations.push(`${path}:${line} passes plaintext apiKey into trackRequest`);
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return violations;
}

const badConsoleFixture = scanSource(
  'declare const apiKey: string; console.log({ apiKey });',
  'fixture/bad-console.ts',
);
if (badConsoleFixture.length !== 1) {
  throw new Error('Violation fixture failed: API-key identifier logging was not rejected.');
}

const badTrackFixture = scanSource(
  'declare function trackRequest(value: unknown): void; declare const apiKey: string; trackRequest({ apiKey });',
  'fixture/bad-track.ts',
);
if (badTrackFixture.length !== 1) {
  throw new Error('Violation fixture failed: API-key identifier tracking was not rejected.');
}

const legitimateFixture = scanSource(
  "declare const provider: string; console.log({ provider }); trackRequest({ apiKeyId: 'key-id' });",
  'fixture/legitimate.ts',
);
if (legitimateFixture.length !== 0) {
  throw new Error(`Legitimate fixture was rejected:\n${legitimateFixture.join('\n')}`);
}

const violations = sourceFiles(srcRoot).flatMap((path) =>
  scanSource(readFileSync(path, 'utf8'), path),
);

if (violations.length) {
  throw new Error(`Secret logging boundary failed:\n${violations.join('\n')}`);
}

console.log('LOG_SECRET_BOUNDARY PASS (source + violation/pass fixtures)');

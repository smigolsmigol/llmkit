import { existsSync, readFileSync } from 'node:fs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

assert(
  !existsSync('.github/workflows/daily-digest.yml'),
  'the low-signal daily vanity digest must stay retired',
);
assert(
  !existsSync('.github/workflows/weekly-recap.yml'),
  'the duplicate weekly vanity recap must stay retired',
);

const pricing = readFileSync('.github/workflows/update-pricing.yml', 'utf8');

function assertPricingPrContract(contents) {
  const create = contents.indexOf('PR_URL=$(gh pr create');
  const label = contents.indexOf('if ! gh pr edit "$PR_URL" --add-label "distribution"; then');
  assert(create >= 0 && label > create, 'pricing must create the PR before optional labeling');
  assert(
    contents.includes('::warning::Pricing PR created without the optional distribution label'),
    'an optional pricing label failure must remain visible without losing the PR',
  );
  assert(
    contents.includes('affected package patch versions') && contents.includes('--draft)'),
    'generated pricing changes must stay draft-only until their release versions are prepared',
  );
  assert(!contents.includes('--label "automated"'), 'pricing PR creation must not require a label');
}

assertPricingPrContract(pricing);
let hardLabelFailureBlocked = false;
try {
  assertPricingPrContract(pricing.replace(
    'if ! gh pr edit "$PR_URL" --add-label "distribution"; then',
    'gh pr edit "$PR_URL" --add-label "distribution"',
  ));
} catch {
  hardLabelFailureBlocked = true;
}
assert(hardLabelFailureBlocked, 'pricing accepted a required post-creation label mutation');
let readyPricingPrBlocked = false;
try {
  assertPricingPrContract(pricing.replace('            --draft)', ')'));
} catch {
  readyPricingPrBlocked = true;
}
assert(readyPricingPrBlocked, 'pricing accepted a release-unprepared ready-for-review PR');

assert(pricing.includes("cron: '17 6 * * 0'"), 'pricing refresh must run once weekly');
assert(!pricing.includes("cron: '0 6 * * *'"), 'the daily pricing schedule must stay retired');
const install = pricing.indexOf('pnpm install --frozen-lockfile');
const bootstrap = pricing.indexOf('corepack pnpm@9.15.4 quality:bootstrap');
const fetch = pricing.indexOf('node scripts/fetch-pricing.mjs');
assert(install >= 0 && install < bootstrap && bootstrap < fetch, 'pricing needs pinned tools before generation');
assert(
  pricing.includes('LLMKIT_QUALITY_PYTHON: $' + '{{ github.workspace }}/.venv/bin/python'),
  'pricing generation must use the formatter environment created by quality:bootstrap',
);
assert(
  pricing.includes('if [ -z "$TG_TOKEN" ] || [ -z "$TG_CHAT" ]; then'),
  'pricing failure delivery must tolerate absent Telegram secrets',
);

const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
assert(
  ci.includes("github.actor != 'dependabot[bot]'"),
  'Dependabot failures must not launch a second notification job',
);
assert(
  ci.includes('if [ -z "$TELEGRAM_BOT_TOKEN" ] || [ -z "$TELEGRAM_CHAT_ID" ]; then'),
  'CI failure delivery must tolerate absent Telegram secrets',
);

const dependabot = readFileSync('.github/dependabot.yml', 'utf8');
assert(
  (dependabot.match(/interval: "monthly"/g) || []).length === 3,
  'all version-update ecosystems must use the monthly maintenance window',
);
assert(
  dependabot.includes('open-pull-requests-limit: 2')
    && (dependabot.match(/open-pull-requests-limit: 1/g) || []).length === 2,
  'version-update concurrency must remain bounded',
);
assert(
  dependabot.includes('python-dependencies:') && dependabot.includes('github-actions:'),
  'Python and Actions updates must remain grouped',
);

console.log('NOTIFICATION_SIGNAL_WORKFLOW_CONTRACT PASS');

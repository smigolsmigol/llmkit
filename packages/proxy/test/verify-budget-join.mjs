// verify PostgREST resource embedding for the budget JOIN
// proves that findApiKey returns budget data alongside the API key
//
// usage: SUPABASE_URL=xxx SUPABASE_KEY=xxx node test/verify-budget-join.mjs
//
// this hits real Supabase, no mocks. run manually to verify the FK embedding works.

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_KEY;

if (!url || !key) {
  console.error('SUPABASE_URL and SUPABASE_KEY env vars required');
  console.error('usage: SUPABASE_URL=xxx SUPABASE_KEY=xxx node test/verify-budget-join.mjs');
  process.exit(1);
}

async function postgrest(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: {
      'apikey': key,
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`PostgREST error (${res.status}): ${body}`);
    process.exit(1);
  }
  return res.json();
}

console.log('verifying PostgREST budget JOIN\n');

// 1. check that the embedded select works at all
console.log('1. testing embedded select syntax...');
const keysWithBudgets = await postgrest(
  'api_keys?select=id,user_id,key_prefix,name,budget_id,rpm_limit,budgets(limit_cents,period)&limit=5'
);
console.log(`   returned ${keysWithBudgets.length} keys`);

if (keysWithBudgets.length === 0) {
  console.log('   no API keys in DB. create one via dashboard first.');
  process.exit(0);
}

// 2. verify shape
for (const k of keysWithBudgets) {
  const hasBudgetId = k.budget_id !== null;
  const hasBudgetObj = k.budgets !== null;
  const hasRpmLimit = typeof k.rpm_limit === 'number';

  console.log(`   key ${k.key_prefix}: budget_id=${k.budget_id || 'null'}, budgets=${hasBudgetObj ? JSON.stringify(k.budgets) : 'null'}, rpm_limit=${k.rpm_limit}`);

  if (hasBudgetId && !hasBudgetObj) {
    console.error(`   ERROR: key has budget_id but budgets is null. FK embedding broken.`);
    process.exit(1);
  }

  if (hasBudgetObj) {
    if (typeof k.budgets.limit_cents !== 'number') {
      console.error(`   ERROR: budgets.limit_cents is not a number: ${typeof k.budgets.limit_cents}`);
      process.exit(1);
    }
    if (!['daily', 'weekly', 'monthly', 'total'].includes(k.budgets.period)) {
      console.error(`   ERROR: budgets.period is invalid: ${k.budgets.period}`);
      process.exit(1);
    }
  }

  if (!hasRpmLimit) {
    console.error(`   ERROR: rpm_limit is not a number: ${typeof k.rpm_limit}`);
    process.exit(1);
  }
}

// 3. check budgets table
console.log('\n2. checking budgets table...');
const budgets = await postgrest('budgets?select=id,name,limit_cents,period&limit=5');
console.log(`   ${budgets.length} budgets found`);
for (const b of budgets) {
  console.log(`   ${b.name}: ${b.limit_cents}c (${b.period})`);
}

console.log('\nall checks passed');

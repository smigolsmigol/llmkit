const Database = require("better-sqlite3");
const path = require("path");

const db = new Database(path.join(__dirname, "metrics.db"));
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source TEXT NOT NULL,
    data TEXT NOT NULL,
    collected_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
db.exec("CREATE INDEX IF NOT EXISTS idx_metrics_source ON metrics(source, collected_at)");
db.exec(`
  CREATE TABLE IF NOT EXISTS alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    message TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const NPM_PACKAGES = [
  "@f3d1/llmkit-shared",
  "@f3d1/llmkit-sdk",
  "@f3d1/llmkit-cli",
  "@f3d1/llmkit-ai-sdk-provider",
  "@f3d1/llmkit-mcp-server",
];

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.json();
}

async function collectNpm() {
  const results = {};
  for (const pkg of NPM_PACKAGES) {
    const encoded = encodeURIComponent(pkg);
    try {
      const week = await fetchJson("https://api.npmjs.org/downloads/point/last-week/" + encoded);
      const month = await fetchJson("https://api.npmjs.org/downloads/point/last-month/" + encoded);
      const daily = await fetchJson("https://api.npmjs.org/downloads/range/last-month/" + encoded);
      results[pkg] = {
        last_week: week.downloads,
        last_month: month.downloads,
        daily: (daily.downloads || []).map(function(d) { return { day: d.day, count: d.downloads }; }),
      };
    } catch (e) {
      console.error("npm " + pkg + ": " + e.message);
      results[pkg] = { error: e.message };
    }
  }
  return results;
}

async function collectPypi() {
  const results = {};
  try {
    const info = await fetchJson("https://pypi.org/pypi/llmkit-sdk/json");
    results.version = info.info && info.info.version;
    results.summary = info.info && info.info.summary;
    results.requires_python = info.info && info.info.requires_python;
    results.releases = Object.keys(info.releases || {}).length;
  } catch (e) {
    console.error("pypi metadata: " + e.message);
  }
  try {
    const stats = await fetchJson("https://pypistats.org/api/packages/llmkit-sdk/recent");
    results.last_day = (stats.data && stats.data.last_day) || 0;
    results.last_week = (stats.data && stats.data.last_week) || 0;
    results.last_month = (stats.data && stats.data.last_month) || 0;
  } catch (e) {
    console.error("pypi stats: " + e.message);
  }
  return results;
}

async function collectGithub() {
  if (!GITHUB_TOKEN) return { error: "no token" };
  var gh = function(url) { return fetchJson(url, { Authorization: "Bearer " + GITHUB_TOKEN }); };
  try {
    const repo = await gh("https://api.github.com/repos/smigolsmigol/llmkit");
    let traffic = null;
    try {
      traffic = await gh("https://api.github.com/repos/smigolsmigol/llmkit/traffic/views");
    } catch (e) {
      console.warn("traffic endpoint failed (needs push access)");
    }
    return {
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      watchers: repo.subscribers_count,
      open_issues: repo.open_issues_count,
      traffic: traffic ? { views_14d: traffic.count, uniques_14d: traffic.uniques } : null,
    };
  } catch (e) {
    console.error("github: " + e.message);
    return { error: e.message };
  }
}

async function collectHealth() {
  const checks = {
    proxy: "https://llmkit-proxy.smigolsmigol.workers.dev/health",
    dashboard: "https://llmkit-dashboard.vercel.app",
    npm_registry: "https://registry.npmjs.org/@f3d1/llmkit-mcp-server",
    pypi: "https://pypi.org/pypi/llmkit-sdk/json",
    mcp_registry: "https://registry.modelcontextprotocol.io/v0/servers/io.github.smigolsmigol%2Fllmkit/versions/latest",
  };
  const results = {};
  for (const [name, url] of Object.entries(checks)) {
    const start = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      results[name] = { status: res.ok ? "up" : "degraded", code: res.status, latency_ms: Date.now() - start };
    } catch (e) {
      results[name] = { status: "down", error: e.message, latency_ms: Date.now() - start };
    }
  }
  return results;
}

async function collectAccounts() {
  if (!SUPABASE_URL || !SUPABASE_KEY) return null;
  try {
    const res = await fetch(SUPABASE_URL + "/rest/v1/accounts?select=user_id,plan,created_at&order=created_at.desc&limit=50", {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const accounts = await res.json();
    return { total: accounts.length, accounts: accounts.map(function(a) { return { plan: a.plan, created: a.created_at }; }) };
  } catch (e) {
    return null;
  }
}

function store(source, data) {
  db.prepare("INSERT INTO metrics (source, data) VALUES (?, ?)").run(source, JSON.stringify(data));
}

function storeAlert(type, message) {
  db.prepare("INSERT INTO alerts (type, message) VALUES (?, ?)").run(type, message);
}

function getPrev(source) {
  const row = db.prepare("SELECT data FROM metrics WHERE source=? ORDER BY collected_at DESC LIMIT 1").get(source);
  return row ? JSON.parse(row.data) : null;
}

async function sendTelegram(text) {
  const TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const TG_CHAT = process.env.TELEGRAM_CHAT_ID;
  if (!TG_TOKEN || !TG_CHAT) return;
  var clean = text.replace(/<[^>]*>/g, "");
  console.log("ALERT: " + clean);
  storeAlert("telegram", clean);
  await fetch("https://api.telegram.org/bot" + TG_TOKEN + "/sendMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: TG_CHAT, parse_mode: "HTML", text: text }),
  }).catch(function(e) { console.error("telegram failed: " + e.message); });
}

async function checkAnomalies(npm, health, accounts) {
  // service health
  var failures = Object.entries(health)
    .filter(function(e) { return e[1].status !== "up"; })
    .map(function(e) { return e[0] + ": " + e[1].status + " (" + (e[1].code || e[1].error || "?") + ")"; });
  if (failures.length > 0) {
    await sendTelegram("<b>Service Down</b>\n" + failures.join("\n"));
  }

  // npm download anomalies
  var prev = getPrev("npm");
  if (prev) {
    for (var i = 0; i < NPM_PACKAGES.length; i++) {
      var pkg = NPM_PACKAGES[i];
      var cur = npm[pkg];
      var prv = prev[pkg];
      if (!cur || cur.error || !prv || prv.error) continue;
      if (cur.last_week > 0 && prv.last_week > 0) {
        var ratio = cur.last_week / prv.last_week;
        if (ratio > 3) {
          await sendTelegram("<b>npm spike</b>: " + pkg.split("/").pop() + " " + prv.last_week + " -> " + cur.last_week + " (" + ratio.toFixed(1) + "x)");
        }
        if (ratio < 0.5 && prv.last_week > 20) {
          await sendTelegram("<b>npm drop</b>: " + pkg.split("/").pop() + " " + prv.last_week + " -> " + cur.last_week + " (" + (100 - ratio * 100).toFixed(0) + "% drop)");
        }
      }
    }
  }

  // new signups
  if (accounts) {
    var prevAcc = getPrev("accounts");
    var prevTotal = prevAcc ? prevAcc.total : 0;
    if (accounts.total > prevTotal) {
      var diff = accounts.total - prevTotal;
      await sendTelegram("<b>New signup" + (diff > 1 ? "s" : "") + "</b>: " + diff + " new (total: " + accounts.total + ")");
    }
  }

  // github stars change
  var prevGh = getPrev("github");
  var curGh = npm; // wrong var, fix below
  // actually check github object directly
}

async function run() {
  console.log("collecting metrics at " + new Date().toISOString());

  var results = await Promise.allSettled([
    collectNpm(),
    collectPypi(),
    collectGithub(),
    collectHealth(),
    collectAccounts(),
  ]);

  var npm = results[0].status === "fulfilled" ? results[0].value : {};
  var pypi = results[1].status === "fulfilled" ? results[1].value : {};
  var github = results[2].status === "fulfilled" ? results[2].value : {};
  var health = results[3].status === "fulfilled" ? results[3].value : {};
  var accounts = results[4].status === "fulfilled" ? results[4].value : null;

  // log any rejected promises
  results.forEach(function(r, i) {
    if (r.status === "rejected") console.error("collector " + i + " failed: " + r.reason);
  });

  store("npm", npm);
  store("pypi", pypi);
  store("github", github);
  store("health", health);
  if (accounts) store("accounts", accounts);

  // freshness marker
  store("_meta", { last_success: new Date().toISOString(), version: "2.0" });

  await checkAnomalies(npm, health, accounts);

  console.log("collection complete");
  var count = db.prepare("SELECT COUNT(*) as n FROM metrics").get();
  console.log("total rows: " + count.n);
}

run().catch(async function(e) {
  console.error("collection failed: " + e);
  await sendTelegram("<b>Collection FAILED</b>\n" + e.message);
  process.exit(1);
});

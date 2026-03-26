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

const INSTALLS_PER_CI_RUN = 10;

async function fetchJson(url, headers = {}) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(url + " -> " + res.status);
  return res.json();
}

async function collectCIRuns() {
  if (!GITHUB_TOKEN) return {};
  try {
    var since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
    var data = await fetchJson(
      "https://api.github.com/repos/smigolsmigol/llmkit/actions/runs?per_page=100&created=>" + since,
      { Authorization: "Bearer " + GITHUB_TOKEN }
    );
    var runs = data.workflow_runs || [];
    var byDay = {};
    for (var i = 0; i < runs.length; i++) {
      var day = runs[i].created_at.slice(0, 10);
      byDay[day] = (byDay[day] || 0) + 1;
    }
    return byDay;
  } catch (e) {
    console.error("ci_runs: " + e.message);
    return {};
  }
}

async function collectNpm(ciRunsByDay) {
  var results = {};
  for (var idx = 0; idx < NPM_PACKAGES.length; idx++) {
    var pkg = NPM_PACKAGES[idx];
    var encoded = encodeURIComponent(pkg);
    try {
      var week = await fetchJson("https://api.npmjs.org/downloads/point/last-week/" + encoded);
      var month = await fetchJson("https://api.npmjs.org/downloads/point/last-month/" + encoded);
      var daily = await fetchJson("https://api.npmjs.org/downloads/range/last-month/" + encoded);
      var rawDaily = (daily.downloads || []).map(function(d) { return { day: d.day, count: d.downloads }; });

      var organicDaily = rawDaily.map(function(d) {
        var ciRuns = ciRunsByDay[d.day] || 0;
        var noise = Math.round(ciRuns * INSTALLS_PER_CI_RUN / NPM_PACKAGES.length);
        var organic = Math.max(0, d.count - noise);
        return { day: d.day, count: d.count, organic: organic, ci_noise: noise };
      });

      var organicWeek = organicDaily.slice(-7).reduce(function(s, d) { return s + d.organic; }, 0);
      var organicMonth = organicDaily.reduce(function(s, d) { return s + d.organic; }, 0);

      results[pkg] = {
        last_week: week.downloads,
        last_month: month.downloads,
        organic_week: organicWeek,
        organic_month: organicMonth,
        daily: organicDaily,
      };
    } catch (e) {
      console.error("npm " + pkg + ": " + e.message);
      results[pkg] = { error: e.message };
    }
  }
  return results;
}

async function collectPypi() {
  var results = {};
  try {
    var info = await fetchJson("https://pypi.org/pypi/llmkit-sdk/json");
    results.version = info.info && info.info.version;
  } catch (e) {
    console.error("pypi metadata: " + e.message);
  }
  try {
    var stats = await fetchJson("https://pypistats.org/api/packages/llmkit-sdk/recent");
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
    var repo = await gh("https://api.github.com/repos/smigolsmigol/llmkit");
    var traffic = null;
    try { traffic = await gh("https://api.github.com/repos/smigolsmigol/llmkit/traffic/views"); } catch (e) {}
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
  var checks = {
    proxy: "https://llmkit-proxy.smigolsmigol.workers.dev/health",
    dashboard: "https://llmkit-dashboard.vercel.app",
    npm_registry: "https://registry.npmjs.org/@f3d1/llmkit-mcp-server",
    pypi: "https://pypi.org/pypi/llmkit-sdk/json",
    mcp_registry: "https://registry.modelcontextprotocol.io/v0/servers/io.github.smigolsmigol%2Fllmkit/versions/latest",
  };
  var results = {};
  for (var [name, url] of Object.entries(checks)) {
    var start = Date.now();
    try {
      var res = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
    var res = await fetch(SUPABASE_URL + "/rest/v1/accounts?select=user_id,plan,created_at&order=created_at.desc&limit=50", {
      headers: { apikey: SUPABASE_KEY, Authorization: "Bearer " + SUPABASE_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    var accounts = await res.json();
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
  var row = db.prepare("SELECT data FROM metrics WHERE source=? ORDER BY collected_at DESC LIMIT 1").get(source);
  return row ? JSON.parse(row.data) : null;
}

async function sendTelegram(text) {
  var TG_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  var TG_CHAT = process.env.TELEGRAM_CHAT_ID;
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
  var failures = Object.entries(health)
    .filter(function(e) { return e[1].status !== "up"; })
    .map(function(e) { return e[0] + ": " + e[1].status + " (" + (e[1].code || e[1].error || "?") + ")"; });
  if (failures.length > 0) {
    await sendTelegram("<b>Service Down</b>\n" + failures.join("\n"));
  }

  var prev = getPrev("npm");
  if (prev) {
    for (var i = 0; i < NPM_PACKAGES.length; i++) {
      var pkg = NPM_PACKAGES[i];
      var cur = npm[pkg];
      var prv = prev[pkg];
      if (!cur || cur.error || !prv || prv.error) continue;
      var curWeek = cur.organic_week || cur.last_week;
      var prvWeek = prv.organic_week || prv.last_week;
      if (curWeek > 0 && prvWeek > 0) {
        var ratio = curWeek / prvWeek;
        if (ratio > 3) {
          await sendTelegram("<b>npm spike (organic)</b>: " + pkg.split("/").pop() + " " + prvWeek + " -> " + curWeek);
        }
      }
    }
  }

  if (accounts) {
    var prevAcc = getPrev("accounts");
    var prevTotal = prevAcc ? prevAcc.total : 0;
    if (accounts.total > prevTotal) {
      var diff = accounts.total - prevTotal;
      await sendTelegram("<b>New signup" + (diff > 1 ? "s" : "") + "</b>: " + diff + " new (total: " + accounts.total + ")");
    }
  }
}

async function run() {
  console.log("collecting metrics at " + new Date().toISOString());
  var ciRunsByDay = await collectCIRuns();
  console.log("CI runs (30d):", Object.keys(ciRunsByDay).length + " active days");

  var results = await Promise.allSettled([
    collectNpm(ciRunsByDay),
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

  results.forEach(function(r, i) {
    if (r.status === "rejected") console.error("collector " + i + " failed: " + r.reason);
  });

  store("npm", npm);
  store("ci_runs", ciRunsByDay);
  store("pypi", pypi);
  store("github", github);
  store("health", health);
  if (accounts) store("accounts", accounts);
  store("_meta", { last_success: new Date().toISOString(), version: "2.1" });

  await checkAnomalies(npm, health, accounts);
  console.log("collection complete (v2.1 organic estimates)");
}

run().catch(async function(e) {
  console.error("collection failed: " + e);
  await sendTelegram("<b>Collection FAILED</b>\n" + e.message);
  process.exit(1);
});

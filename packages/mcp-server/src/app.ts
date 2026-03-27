// MCP App: interactive cost dashboard rendered in an iframe inside the chat.
// Self-contained HTML with inline CSS/JS. No external dependencies.
// Implements the MCP Apps postMessage protocol directly (no ext-apps SDK needed).

export const RESOURCE_URI = 'ui://llmkit/session-cost';
export const RESOURCE_MIME = 'text/html+mcp';
export const DASHBOARD_URL = process.env.LLMKIT_DASHBOARD_URL || 'https://llmkit-dashboard.vercel.app';

export const DASHBOARD_HTML = /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>LLMKit Session Cost</title>
<style>
  :root {
    --bg: #0a0a0a;
    --surface: #111111;
    --border: #1f1f1f;
    --text: #fafafa;
    --muted: #888888;
    --accent: #7c3aed;
    --green: #14b8a6;
    --amber: #3b82f6;
    --red: #ef4444;
    --chart1: #7c3aed;
    --chart2: #14b8a6;
    --chart3: #3b82f6;
    --chart4: #a855f7;
    --chart5: #06b6d4;
  }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    background: var(--bg);
    color: var(--text);
    padding: 16px;
    font-size: 13px;
    line-height: 1.5;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 16px;
  }
  .header h1 {
    font-size: 15px;
    font-weight: 600;
    color: var(--accent);
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .logo-img { width: 44px; height: 44px; border-radius: 6px; }
  .spinner { width: 14px; height: 14px; flex-shrink: 0; }
  .logo-text {
    animation: textGlow 3s ease-in-out infinite;
  }
  @keyframes textGlow {
    0%, 100% { text-shadow: 0 0 4px rgba(124, 58, 237, 0.0); }
    50% { text-shadow: 0 0 8px rgba(124, 58, 237, 0.4); }
  }
  .refresh-btn {
    background: var(--surface);
    border: 1px solid var(--border);
    color: var(--muted);
    padding: 4px 10px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 12px;
    transition: all 0.15s;
  }
  .refresh-btn:hover { color: var(--text); border-color: var(--accent); }
  .refresh-btn:disabled { opacity: 0.5; cursor: not-allowed; }

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: 10px;
    margin-bottom: 16px;
  }
  .stat {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 6px;
    padding: 10px;
  }
  .stat-label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; }
  .stat-value { font-size: 20px; font-weight: 700; margin-top: 2px; }
  .stat-value.cost { color: var(--accent); }
  .stat-sub { font-size: 11px; color: var(--muted); margin-top: 2px; }

  .section { margin-bottom: 16px; }
  .section-title { font-size: 12px; font-weight: 600; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 8px; }

  .bar-chart { display: flex; flex-direction: column; gap: 6px; }
  .bar-row { display: flex; align-items: center; gap: 8px; }
  .bar-label { width: 140px; font-size: 11px; color: var(--muted); text-align: right; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; flex-shrink: 0; }
  .bar-track { flex: 1; height: 18px; background: var(--surface); border-radius: 3px; overflow: hidden; position: relative; }
  .bar-fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; min-width: 2px; }
  .bar-fill.cost { background: var(--chart1); }
  .bar-fill.input { background: var(--chart2); }
  .bar-fill.output { background: var(--chart3); }
  .bar-fill.cache { background: var(--chart4); }
  .bar-amount { width: 65px; font-size: 11px; color: var(--text); text-align: right; font-variant-numeric: tabular-nums; flex-shrink: 0; }

  .token-row { display: flex; gap: 8px; margin-bottom: 6px; }
  .token-chip {
    flex: 1;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 6px 8px;
    text-align: center;
  }
  .token-chip .label { font-size: 10px; color: var(--muted); text-transform: uppercase; }
  .token-chip .value { font-size: 13px; font-weight: 600; margin-top: 1px; }
  .token-chip .value.in { color: var(--chart2); }
  .token-chip .value.out { color: var(--chart3); }
  .token-chip .value.cr { color: var(--chart4); }
  .token-chip .value.cw { color: var(--chart5); }

  .note { font-size: 11px; color: var(--muted); font-style: italic; }
  .footer { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; padding-top: 8px; border-top: 1px solid var(--border); }
  .footer a { color: var(--accent); text-decoration: none; font-size: 11px; font-weight: 500; }
  .footer a:hover { text-decoration: underline; }
  .loading { text-align: center; padding: 40px; color: var(--muted); }
  .error { color: var(--red); text-align: center; padding: 20px; }

  @media (prefers-color-scheme: light) {
    :root {
      --bg: #ffffff;
      --surface: #ffffff;
      --border: #e5e5e5;
      --text: #0a0a0a;
      --muted: #737373;
      --accent: #7c3aed;
      --red: #ef4444;
    }
  }
</style>
</head>
<body>
<div id="app"><div class="loading">Waiting for session data...</div></div>

<script>
(function() {
  'use strict';

  // --- MCP Apps postMessage protocol (minimal implementation) ---

  var pendingRequests = {};
  var nextId = 1;

  function sendRpc(method, params) {
    var id = nextId++;
    return new Promise(function(resolve, reject) {
      pendingRequests[id] = { resolve: resolve, reject: reject };
      window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params || {} }, '*');
    });
  }

  window.addEventListener('message', function(event) {
    var msg = event.data;
    if (!msg || msg.jsonrpc !== '2.0') return;

    // response to our request
    if (msg.id && pendingRequests[msg.id]) {
      var p = pendingRequests[msg.id];
      delete pendingRequests[msg.id];
      if (msg.error) p.reject(msg.error);
      else p.resolve(msg.result);
      return;
    }

    // notification from host
    if (msg.method === 'ui/toolResult') {
      handleToolResult(msg.params);
    }
    if (msg.method === 'ui/hostContextChanged') {
      applyHostContext(msg.params);
    }
  });

  // initialize connection
  sendRpc('ui/initialize', {
    name: 'LLMKit Cost Dashboard',
    version: '1.0.0',
    capabilities: {}
  }).then(function(result) {
    if (result && result.hostContext) applyHostContext(result.hostContext);
  }).catch(function() {
    // host may not support ui/initialize yet, still render
  });

  function applyHostContext(ctx) {
    if (!ctx) return;
    var root = document.documentElement.style;
    if (ctx.theme === 'light') {
      root.setProperty('--bg', '#ffffff');
      root.setProperty('--surface', '#ffffff');
      root.setProperty('--border', '#e5e5e5');
      root.setProperty('--text', '#0a0a0a');
      root.setProperty('--muted', '#737373');
    } else if (ctx.theme === 'dark') {
      root.setProperty('--bg', '#0a0a0a');
      root.setProperty('--surface', '#111111');
      root.setProperty('--border', '#1f1f1f');
      root.setProperty('--text', '#fafafa');
      root.setProperty('--muted', '#888888');
    }
  }

  // --- Dashboard rendering ---

  function fmt(n) { return n.toLocaleString(); }
  function usd(n) { return '$' + n.toFixed(4); }
  function pct(n, total) { return total > 0 ? Math.min((n / total) * 100, 100) : 0; }
  function kTokens(n) { return (n / 1000).toFixed(0) + 'k'; }

  function handleToolResult(params) {
    var result = params;
    if (!result) return;

    // structuredContent has the data we need, content has text fallback
    var data = result.structuredContent || result;

    // if we got the raw tool result wrapper, unwrap
    if (data.result) data = data.result;
    if (data.structuredContent) data = data.structuredContent;

    if (!data.sessionId && !data.totalCostUsd && data.totalCostUsd !== 0) {
      document.getElementById('app').innerHTML = '<div class="error">No session data available</div>';
      return;
    }

    renderDashboard(data);
  }

  function esc(s) { var el = document.createElement('span'); el.textContent = s; return el.innerHTML.replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }

  function renderDashboard(d) {
    var models = d.models || [];
    var maxCost = Math.max.apply(null, models.map(function(m) { return m.costUsd || 0; }).concat([0.0001]));
    var totalTokens = (d.inputTokens || 0) + (d.outputTokens || 0);

    var html = '';

    // header
    html += '<div class="header">';
    html += '<h1>';
    html += '<img class="logo-img" src="data:image/png;base64,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" alt="LLMKit"/>';
    html += '<span class="logo-text">LLMKit Session Cost</span>';
    html += '<svg class="spinner" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">';
    html += '<circle cx="12" cy="12" r="8" fill="none" stroke="var(--accent)" stroke-width="1.5" opacity="0.25"/>';
    html += '<circle cx="12" cy="4" r="2" fill="var(--accent)" opacity="0.9"><animateTransform attributeName="transform" type="rotate" from="0 12 12" to="360 12 12" dur="2.5s" repeatCount="indefinite"/></circle>';
    html += '</svg>';
    html += '</h1>';
    html += '<button class="refresh-btn" id="refresh">Refresh</button>';
    html += '</div>';

    // stat cards
    html += '<div class="stat-grid">';
    html += '<div class="stat"><div class="stat-label">Estimated Cost</div><div class="stat-value cost">' + usd(d.totalCostUsd || 0) + '</div><div class="stat-sub">at API rates</div></div>';
    html += '<div class="stat"><div class="stat-label">Messages</div><div class="stat-value">' + fmt(d.messages || 0) + '</div><div class="stat-sub">assistant turns</div></div>';
    html += '<div class="stat"><div class="stat-label">Total Tokens</div><div class="stat-value">' + kTokens(totalTokens) + '</div><div class="stat-sub">' + kTokens(d.inputTokens || 0) + ' in / ' + kTokens(d.outputTokens || 0) + ' out</div></div>';
    html += '</div>';

    // token breakdown
    html += '<div class="section">';
    html += '<div class="section-title">Token Breakdown</div>';
    html += '<div class="token-row">';
    html += '<div class="token-chip"><div class="label">Input</div><div class="value in">' + fmt(d.inputTokens || 0) + '</div></div>';
    html += '<div class="token-chip"><div class="label">Output</div><div class="value out">' + fmt(d.outputTokens || 0) + '</div></div>';
    html += '<div class="token-chip"><div class="label">Cache Read</div><div class="value cr">' + fmt(d.cacheReadTokens || 0) + '</div></div>';
    html += '<div class="token-chip"><div class="label">Cache Write</div><div class="value cw">' + fmt(d.cacheWriteTokens || 0) + '</div></div>';
    html += '</div></div>';

    // model cost chart
    if (models.length > 0) {
      html += '<div class="section">';
      html += '<div class="section-title">Cost by Model</div>';
      html += '<div class="bar-chart">';
      for (var i = 0; i < models.length; i++) {
        var m = models[i];
        var w = pct(m.costUsd || 0, maxCost);
        var label = (m.model || '').replace('claude-', '').replace(/-\\d{8}$/, '');
        html += '<div class="bar-row">';
        html += '<div class="bar-label" title="' + esc(m.model || '') + '">' + esc(label) + '</div>';
        html += '<div class="bar-track"><div class="bar-fill cost" style="width:' + w + '%"></div></div>';
        html += '<div class="bar-amount">' + usd(m.costUsd || 0) + '</div>';
        html += '</div>';
      }
      html += '</div></div>';

      // token distribution per model
      var maxTokens = Math.max.apply(null, models.map(function(m) { return (m.inputTokens || 0) + (m.outputTokens || 0); }).concat([1]));
      html += '<div class="section">';
      html += '<div class="section-title">Tokens by Model</div>';
      html += '<div class="bar-chart">';
      for (var j = 0; j < models.length; j++) {
        var m2 = models[j];
        var inp = m2.inputTokens || 0;
        var out = m2.outputTokens || 0;
        var tot = inp + out;
        var wIn = pct(inp, maxTokens);
        var wOut = pct(out, maxTokens);
        var lbl = (m2.model || '').replace('claude-', '').replace(/-\\d{8}$/, '');
        html += '<div class="bar-row">';
        html += '<div class="bar-label" title="' + esc(m2.model || '') + '">' + esc(lbl) + '</div>';
        html += '<div class="bar-track">';
        html += '<div class="bar-fill input" style="width:' + wIn + '%; display:inline-block; vertical-align:top;"></div>';
        html += '<div class="bar-fill output" style="width:' + wOut + '%; display:inline-block; vertical-align:top;"></div>';
        html += '</div>';
        html += '<div class="bar-amount">' + kTokens(tot) + '</div>';
        html += '</div>';
      }
      html += '<div style="margin-top:4px;font-size:10px;color:var(--muted)">';
      html += '<span style="color:var(--chart2)">&#9632;</span> input ';
      html += '<span style="color:var(--chart3)">&#9632;</span> output';
      html += '</div>';
      html += '</div></div>';
    }

    // footer
    html += '<div class="footer">';
    html += '<div class="note">Session ' + esc((d.sessionId || '').slice(0, 12)) + '... - estimated at API rates</div>';
    html += '<a href="__DASHBOARD_URL__" target="_blank">View full history &#8594;</a>';
    html += '</div>';

    document.getElementById('app').innerHTML = html;

    // refresh button
    var btn = document.getElementById('refresh');
    if (btn) {
      btn.addEventListener('click', function() {
        btn.disabled = true;
        btn.textContent = '...';
        sendRpc('tools/call', { name: 'llmkit_local_session', arguments: {} })
          .then(function(result) {
            var data = result;
            if (data && data.structuredContent) data = data.structuredContent;
            if (data) renderDashboard(data);
          })
          .catch(function() {
            btn.textContent = 'Error';
            setTimeout(function() { btn.textContent = 'Refresh'; btn.disabled = false; }, 2000);
          })
          .finally(function() {
            btn.textContent = 'Refresh';
            btn.disabled = false;
          });
      });
    }
  }
})();
</script>
</body>
</html>`;

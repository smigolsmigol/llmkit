#!/usr/bin/env node
/**
 * Doc crawler - fetches all pages from a docs site, saves as local markdown.
 *
 * Usage:
 *   node scripts/crawl-docs.mjs <name> <start-url> [--max-pages=50] [--depth=3]
 *
 * Examples:
 *   node scripts/crawl-docs.mjs xai https://docs.x.ai/docs
 *   node scripts/crawl-docs.mjs openai https://platform.openai.com/docs/api-reference --max-pages=100
 *   node scripts/crawl-docs.mjs vercel-ai-sdk https://sdk.vercel.ai/docs --depth=2
 *
 * Output: docs/external/<name>/ directory with one .md per page + INDEX.md
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'docs', 'external');

const args = process.argv.slice(2);
const flags = args.filter(a => a.startsWith('--'));
const positional = args.filter(a => !a.startsWith('--'));

if (positional.length < 2) {
  console.error('Usage: node scripts/crawl-docs.mjs <name> <start-url|urls-file> [url2] [url3] ... [--max-pages=50] [--depth=3]');
  process.exit(1);
}

const name = positional[0];
const maxPages = parseInt(flags.find(f => f.startsWith('--max-pages='))?.split('=')[1] || '100');
const maxDepth = parseInt(flags.find(f => f.startsWith('--depth='))?.split('=')[1] || '3');

// support: single URL, multiple URLs, or a .txt file with one URL per line
let seedUrls = [];
if (positional[1].endsWith('.txt') && existsSync(positional[1])) {
  seedUrls = readFileSync(positional[1], 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
} else {
  seedUrls = positional.slice(1);
}

const outDir = join(OUT_DIR, name);
mkdirSync(outDir, { recursive: true });

const startOrigin = new URL(seedUrls[0]).origin;
const startPath = new URL(seedUrls[0]).pathname.replace(/\/[^/]*$/, '/');
const visited = new Set();
const pages = [];
const queue = seedUrls.map(url => ({ url, depth: 0 }));

function slugify(url) {
  const u = new URL(url);
  let slug = u.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '_');
  if (!slug) slug = 'index';
  return slug.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function extractLinks(html, baseUrl) {
  const links = [];
  const re = /href="([^"]*?)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    try {
      const abs = new URL(m[1], baseUrl).href;
      const parsed = new URL(abs);
      if (parsed.origin === startOrigin && parsed.pathname.startsWith(startPath)) {
        const clean = parsed.origin + parsed.pathname;
        links.push(clean);
      }
    } catch {}
  }
  return [...new Set(links)];
}

function htmlToMarkdown(html) {
  let text = html;
  // remove script, style, nav, footer, header tags
  text = text.replace(/<script[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<nav[\s\S]*?<\/nav>/gi, '');
  text = text.replace(/<footer[\s\S]*?<\/footer>/gi, '');
  text = text.replace(/<header[\s\S]*?<\/header>/gi, '');
  text = text.replace(/<aside[\s\S]*?<\/aside>/gi, '');

  // try to extract main content
  const mainMatch = text.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i)
    || text.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i)
    || text.match(/<div[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (mainMatch) text = mainMatch[1];

  // convert headings
  text = text.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
  text = text.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
  text = text.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
  text = text.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n');

  // convert code blocks
  text = text.replace(/<pre[^>]*><code[^>]*class="[^"]*language-(\w+)[^"]*"[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```$1\n$2\n```\n');
  text = text.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, '\n```\n$1\n```\n');
  text = text.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');

  // convert links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');

  // convert lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '- $1\n');
  text = text.replace(/<\/?[ou]l[^>]*>/gi, '\n');

  // convert paragraphs
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '$1\n\n');
  text = text.replace(/<br\s*\/?>/gi, '\n');

  // convert bold/italic
  text = text.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
  text = text.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
  text = text.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
  text = text.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');

  // convert tables
  text = text.replace(/<th[^>]*>([\s\S]*?)<\/th>/gi, '| $1 ');
  text = text.replace(/<td[^>]*>([\s\S]*?)<\/td>/gi, '| $1 ');
  text = text.replace(/<tr[^>]*>([\s\S]*?)<\/tr>/gi, '$1|\n');

  // strip remaining HTML tags
  text = text.replace(/<[^>]+>/g, '');

  // decode HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');

  // clean up whitespace
  text = text.replace(/\n{3,}/g, '\n\n').trim();
  return text;
}

async function fetchPage(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'LLMKit-DocCrawler/1.0' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html') && !ct.includes('application/json')) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function crawl() {
  console.log(`Crawling ${seedUrls[0]} (${seedUrls.length} seed URLs) -> docs/external/${name}/`);
  console.log(`Max pages: ${maxPages}, max depth: ${maxDepth}`);

  while (queue.length > 0 && visited.size < maxPages) {
    const { url, depth } = queue.shift();
    const normalized = url.replace(/\/$/, '');
    if (visited.has(normalized)) continue;
    visited.add(normalized);

    process.stdout.write(`  [${visited.size}/${maxPages}] ${normalized.slice(startOrigin.length)}...`);
    const html = await fetchPage(url);
    if (!html) {
      console.log(' SKIP');
      continue;
    }

    const md = htmlToMarkdown(html);
    if (md.length < 50) {
      console.log(' EMPTY');
      continue;
    }

    const slug = slugify(url);
    const title = (html.match(/<title[^>]*>(.*?)<\/title>/i)?.[1] || slug)
      .replace(/\s*[|\\-]\s*.*$/, '').trim();

    const filePath = join(outDir, `${slug}.md`);
    const frontmatter = [
      '---',
      `title: "${title.replace(/"/g, '\\"')}"`,
      `url: "${url}"`,
      `crawled: "${new Date().toISOString().split('T')[0]}"`,
      `source: "${name}"`,
      '---',
      '',
    ].join('\n');

    writeFileSync(filePath, frontmatter + md);
    pages.push({ slug, title, url, chars: md.length });
    console.log(` OK (${md.length} chars)`);

    if (depth < maxDepth) {
      const links = extractLinks(html, url);
      for (const link of links) {
        const norm = link.replace(/\/$/, '');
        if (!visited.has(norm)) {
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }

  // write INDEX.md
  const index = [
    `# ${name} Documentation Index`,
    '',
    `Crawled from ${seedUrls[0]} on ${new Date().toISOString().split('T')[0]}`,
    `${pages.length} pages, ${pages.reduce((s, p) => s + p.chars, 0).toLocaleString()} characters total.`,
    '',
    '| Page | File | Size |',
    '|------|------|------|',
    ...pages.map(p => `| [${p.title}](${p.slug}.md) | ${p.slug}.md | ${p.chars.toLocaleString()} |`),
    '',
  ].join('\n');

  writeFileSync(join(outDir, 'INDEX.md'), index);
  console.log(`\nDone: ${pages.length} pages saved to docs/external/${name}/`);
}

crawl().catch(e => { console.error(e); process.exit(1); });

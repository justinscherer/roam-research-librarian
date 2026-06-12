'use strict';

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

// ── Configuration ─────────────────────────────────────────────────────────────

const SEARCH_TOPICS = [
  'information seeking mobile web',
  'reading behavior mobile interfaces',
  'information seeking',
  'online reading comprehension',
  'curiosity',
];

const RESULTS_PER_QUERY = 10;
const DATE_WINDOW_DAYS = 90;
const ABSTRACT_TRUNCATE = 300;

const SEEN_PAPERS_PATH = path.join(__dirname, '../data/seen-papers.json');
const OUTPUT_PATH = path.join(__dirname, '../data/papers-inbox.md');

const SS_BASE = 'https://api.semanticscholar.org/graph/v1/paper/search';
const FIELDS = 'paperId,title,authors,year,abstract,externalIds,openAccessPdf,publicationDate';

const ROAM_BACKEND_URL = process.env.ROAM_BACKEND_URL || 'https://roam-research.com';
const ROAM_GRAPH_NAME  = process.env.ROAM_GRAPH_NAME;
const ROAM_API_TOKEN   = process.env.ROAM_API_TOKEN;

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d) {
  return d.toISOString().slice(0, 10);
}

function buildDateRange() {
  const today = new Date();
  const from = new Date(today);
  from.setDate(from.getDate() - DATE_WINDOW_DAYS);
  return `${formatDate(from)}:${formatDate(today)}`;
}

function truncate(text, max) {
  if (!text) return 'Abstract not available.';
  return text.length > max ? text.slice(0, max) + '...' : text;
}

function formatAuthors(authors) {
  if (!authors || authors.length === 0) return 'Unknown';
  const names = authors.map((a) => a.name);
  if (names.length <= 3) return names.join(', ');
  return names.slice(0, 3).join(', ') + ' et al.';
}

function buildUrl(paper) {
  const doi = paper.externalIds && paper.externalIds.DOI;
  if (doi) return `https://doi.org/${doi}`;
  return `https://www.semanticscholar.org/paper/${paper.paperId}`;
}

function loadSeenPapers() {
  if (!fs.existsSync(SEEN_PAPERS_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(SEEN_PAPERS_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveSeenPapers(ids) {
  fs.writeFileSync(SEEN_PAPERS_PATH, JSON.stringify(ids, null, 2) + '\n', 'utf8');
}

function renderPaperBlock(paper) {
  const title = paper.title || 'Untitled';
  const year = paper.year || '?';
  const authors = formatAuthors(paper.authors);
  const url = buildUrl(paper);
  const published = paper.publicationDate || String(paper.year) || 'Unknown';
  const abstract = truncate(paper.abstract, ABSTRACT_TRUNCATE);

  return [
    `### ${title} (${year})`,
    `**Authors:** ${authors}`,
    `**Link:** [${url}](${url})`,
    `**Published:** ${published}`,
    `**Abstract:** ${abstract}`,
    `**Tags:** #to-read #research-inbox`,
  ].join('\n');
}

function buildMarkdownSection(papers, runDate) {
  const header = `## New papers — ${runDate}`;
  const blocks = papers.map(renderPaperBlock).join('\n\n---\n\n');
  return `${header}\n\n${blocks}\n`;
}

function prependToFile(filePath, content) {
  let existing = '';
  if (fs.existsSync(filePath)) {
    existing = fs.readFileSync(filePath, 'utf8');
  }
  fs.writeFileSync(filePath, content + '\n' + existing, 'utf8');
}

// ── Roam ──────────────────────────────────────────────────────────────────────

function buildRoamPaperBlock(paper) {
  const title = paper.title || 'Untitled';
  const year = paper.year || '?';
  const authors = formatAuthors(paper.authors);
  const url = buildUrl(paper);
  const published = paper.publicationDate || String(paper.year) || 'Unknown';
  const abstract = truncate(paper.abstract, ABSTRACT_TRUNCATE);

  return {
    string: `**[[${title}]]** (${year}) — ${authors}`,
    children: [
      { string: `📎 [${url}](${url})` },
      { string: `🗓️ Published: ${published}` },
      { string: `📄 ${abstract}` },
      { string: '#[[To Read]] #[[Research Inbox]]' },
    ],
  };
}

async function writeToRoam(papers, runDate) {
  const endpoint = `${ROAM_BACKEND_URL}/api/graph/${ROAM_GRAPH_NAME}/write`;

  const payload = {
    action: 'append-blocks',
    'page-title': 'Papers Inbox',
    blocks: [
      {
        string: `**New papers — ${runDate}**`,
        children: papers.map(buildRoamPaperBlock),
      },
    ],
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${ROAM_API_TOKEN}`,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const body = await res.text();
    console.error(`Roam API error ${res.status}: ${body}`);
    process.exit(1);
  }
}

// ── Fetch ─────────────────────────────────────────────────────────────────────

async function fetchTopic(topic, dateRange) {
  const params = new URLSearchParams({
    query: topic,
    fields: FIELDS,
    limit: String(RESULTS_PER_QUERY),
    publicationDateOrYear: dateRange,
  });

  const headers = { 'Content-Type': 'application/json' };
  if (process.env.SEMANTIC_SCHOLAR_API_KEY) {
    headers['x-api-key'] = process.env.SEMANTIC_SCHOLAR_API_KEY;
  }

  const url = `${SS_BASE}?${params}`;
  const res = await fetch(url, { headers });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`HTTP ${res.status}: ${body}`);
  }

  const data = await res.json();
  return data.data || [];
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const runDate = formatDate(new Date());
  const dateRange = buildDateRange();

  console.log(`Run date: ${runDate}`);
  console.log(`Date window: ${dateRange}`);

  const seenIds = loadSeenPapers();
  const seenSet = new Set(seenIds);

  const allPapers = [];
  const seenInRun = new Set();

  for (const topic of SEARCH_TOPICS) {
    console.log(`Querying: "${topic}"`);
    try {
      const papers = await fetchTopic(topic, dateRange);
      console.log(`  → ${papers.length} results`);
      for (const paper of papers) {
        if (!paper.paperId) continue;
        if (seenSet.has(paper.paperId)) continue;
        if (seenInRun.has(paper.paperId)) continue;
        seenInRun.add(paper.paperId);
        allPapers.push(paper);
      }
    } catch (err) {
      console.error(`  Error fetching "${topic}": ${err.message}`);
    }

    await sleep(1000);
  }

  if (allPapers.length === 0) {
    console.log('No new papers found. Nothing written.');
    return;
  }

  console.log(`Writing ${allPapers.length} new paper(s) to ${OUTPUT_PATH}`);

  const section = buildMarkdownSection(allPapers, runDate);
  prependToFile(OUTPUT_PATH, section);

  const newIds = [...seenIds, ...allPapers.map((p) => p.paperId)];
  saveSeenPapers(newIds);

  if (ROAM_GRAPH_NAME) {
    console.log(`Writing ${allPapers.length} paper(s) to Roam graph "${ROAM_GRAPH_NAME}"...`);
    await writeToRoam(allPapers, runDate);
    console.log('Roam write complete.');
  } else {
    console.log('ROAM_GRAPH_NAME not set — skipping Roam write.');
  }

  console.log(`Done. seen-papers.json now has ${newIds.length} entries.`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

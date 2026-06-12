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

// ── Mock data (USE_MOCK_DATA=true bypasses the API for end-to-end testing) ────

const MOCK_PAPERS = [
  {
    paperId: 'mock-001',
    title: 'How People Seek Information on Mobile Devices',
    year: 2026,
    publicationDate: '2026-04-10',
    authors: [{ name: 'Alice Nakamura' }, { name: 'Ben Osei' }, { name: 'Clara Voss' }, { name: 'David Park' }],
    externalIds: { DOI: '10.1234/mock.001' },
    abstract: 'This paper examines information-seeking patterns on smartphones, finding that users prefer short, scannable content over long-form text when browsing on mobile interfaces.',
  },
  {
    paperId: 'mock-002',
    title: 'Curiosity and Exploration in Digital Reading Environments',
    year: 2026,
    publicationDate: '2026-03-22',
    authors: [{ name: 'Fatima Al-Hassan' }],
    externalIds: {},
    abstract: null,
  },
  {
    paperId: 'mock-003',
    title: 'Online Reading Comprehension Across Device Contexts',
    year: 2026,
    publicationDate: '2026-05-01',
    authors: [{ name: 'George Lindqvist' }, { name: 'Hannah Choi' }],
    externalIds: { DOI: '10.5678/mock.003' },
    abstract: 'A large-scale study of reading comprehension comparing desktop and mobile contexts, with implications for interface design and content formatting in digital learning environments.',
  },
];

async function fetchMockPapers() {
  console.log('  [mock] returning hardcoded papers');
  return MOCK_PAPERS;
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

  if (process.env.USE_MOCK_DATA === 'true') {
    console.log('[mock mode] Skipping API calls.');
    const papers = await fetchMockPapers();
    for (const paper of papers) {
      if (!paper.paperId) continue;
      if (seenSet.has(paper.paperId)) continue;
      seenInRun.add(paper.paperId);
      allPapers.push(paper);
    }
  } else {
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

  console.log(`Done. seen-papers.json now has ${newIds.length} entries.`);
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});

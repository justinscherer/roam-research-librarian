# roam-research-librarian

Automated research librarian. Runs weekly on GitHub Actions, fetches recent academic papers from [Semantic Scholar](https://www.semanticscholar.org/), deduplicates against previous runs, and appends new papers to `data/papers-inbox.md` — committed back to the repo.

## What it does

- Queries Semantic Scholar for papers published in the last 90 days across a set of search topics
- Filters out papers already seen in prior runs
- Writes new papers as a dated markdown section prepended to `data/papers-inbox.md`
- Commits the updated `data/papers-inbox.md` and `data/seen-papers.json` back to the repo

## Setup

1. **Fork this repo** to your own GitHub account.

2. *(Optional)* Add a `SEMANTIC_SCHOLAR_API_KEY` secret for higher API rate limits:
   - Go to **Settings → Secrets and variables → Actions → New repository secret**
   - Name: `SEMANTIC_SCHOLAR_API_KEY`
   - Value: your Semantic Scholar API key ([request one here](https://www.semanticscholar.org/product/api))

   The script works without a key — it just uses the public rate limit.

3. The workflow runs automatically every **Monday at 08:00 UTC**.

## Customizing search topics

Edit the `SEARCH_TOPICS` array at the top of [`scripts/fetch-papers.js`](scripts/fetch-papers.js):

```js
const SEARCH_TOPICS = [
  'information seeking mobile web',
  'reading behavior mobile interfaces',
  'information seeking',
  'online reading comprehension',
  'curiosity',
];
```

Each entry is sent as a separate query to Semantic Scholar.

Other tunable constants in the same block:

| Constant | Default | Description |
|---|---|---|
| `RESULTS_PER_QUERY` | `10` | Papers fetched per topic |
| `DATE_WINDOW_DAYS` | `90` | How far back to look |
| `ABSTRACT_TRUNCATE` | `300` | Max abstract characters |

## Output

New papers are prepended to `data/papers-inbox.md` in this format:

```
## New papers — 2026-06-12

### Title of Paper (2026)
**Authors:** Author One, Author Two et al.
**Link:** https://doi.org/...
**Published:** 2026-05-15
**Abstract:** First 300 characters of the abstract...
**Tags:** #to-read #research-inbox
```

## Triggering a manual run

1. Go to **Actions → Fetch Papers** in your fork
2. Click **Run workflow → Run workflow**

The updated `data/papers-inbox.md` will appear as a new commit within a minute.

## Local testing

```bash
npm install
npm start
```

Set `SEMANTIC_SCHOLAR_API_KEY` in your shell first if you have one. Output is written to `data/papers-inbox.md`.

# Soft 404 QA Briefs

Static MVP for checking pasted URL/status/title/body rows, intended outcome notes, redirect hop counts, and template type before migrations, content pruning, product removals, archive cleanup, and frontend launches.

## Offer

Paste status rows, optional intended outcome notes, redirect hop rows, and template type. Generate a copyable QA brief covering:

- HTTP 200 pages that look like not found, error, no-results, unavailable, or empty pages
- HTTP 204 content gaps
- 404/410 rows whose copy implies valid content
- redirect chains near or over 10 hops
- 5xx and 429 server-error rows
- thin or missing main content snippets
- missing owner decisions
- status/body mismatch in migration QA samples

## Conversion Path

Billing is not connected. The MVP uses early-access, demo-request, and purchase-intent capture with a public-safe GitHub issue handoff.

## Public Assets

- Landing page: https://ert93333-ops.github.io/soft-404-qa-briefs/
- Checklist: https://ert93333-ops.github.io/soft-404-qa-briefs/soft-404-seo-checklist.html
- GitHub Gist checklist: https://gist.github.com/ert93333-ops/0c91935d50d468bb9fb443362518894c

## Marketing Test Links

- Product from Gist: https://ert93333-ops.github.io/soft-404-qa-briefs/?utm_source=github_gist&utm_medium=organic&utm_campaign=soft_404_qa_launch
- Checklist from Gist: https://ert93333-ops.github.io/soft-404-qa-briefs/soft-404-seo-checklist.html?utm_source=github_gist&utm_medium=organic&utm_campaign=soft_404_qa_checklist

## Constraints

- No live crawl.
- No page fetching.
- No Search Console, URL Inspection, PageSpeed, Lighthouse, API, OAuth, paid tool, or backend required.
- No guarantee of crawling, indexing, rankings, or crawl-budget outcomes.
- Pasted samples stay browser-local.

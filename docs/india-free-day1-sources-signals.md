# India Free Day-1 Source Pack (RSS + LinkedIn + X + Signals)

Last updated: 2026-02-06

Purpose: a practical, free source catalog you can plug into your terminal in one day.

## 1) Day-1 Priority (wire these first)

1. `https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1`
2. `https://www.rbi.org.in/notifications_rss.xml`
3. `https://www.sebi.gov.in/sebirss.xml`
4. `https://www.nseindia.com/api/corporate-announcements?index=equities`
5. `https://www.nseindia.com/api/circulars`
6. `https://eprocure.gov.in/eprocure/app`
7. `https://gem.gov.in/`
8. `https://egazette.gov.in/`
9. `https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms`
10. `https://www.livemint.com/rss/markets`

## 2) Verified Free RSS Feeds

| Source | URL | Type | Free | Notes |
|---|---|---|---|---|
| PIB RSS Index | `https://www.pib.gov.in/ViewRss.aspx?lang=1&reg=1` | RSS directory | Yes | Entry page for PIB RSS feeds |
| PIB Press Releases (Delhi) | `https://www.pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=1` | RSS | Yes | Core policy/news feed |
| PIB Media Invitations | `https://www.pib.gov.in/RssMain.aspx?ModId=10&Lang=1&Regid=1` | RSS | Yes | Event/media signals |
| PIB Photos | `https://www.pib.gov.in/RssMain.aspx?ModId=8&Lang=1&Regid=1` | RSS | Yes | Usually lower alpha for market trading |
| RBI RSS Hub | `https://rbi.org.in/Scripts/rss.aspx` | RSS directory | Yes | Lists official RBI feed categories |
| RBI Press Releases | `https://www.rbi.org.in/pressreleases_rss.xml` | RSS | Yes | Monetary ops, banking actions |
| RBI Notifications | `https://www.rbi.org.in/notifications_rss.xml` | RSS | Yes | Regulatory circular-like impact |
| RBI Speeches | `https://www.rbi.org.in/speeches_rss.xml` | RSS | Yes | Forward-guidance style signals |
| RBI Tenders | `https://www.rbi.org.in/tenders_rss.xml` | RSS | Yes | Procurement and infra signals |
| SEBI Master RSS | `https://www.sebi.gov.in/sebirss.xml` | RSS | Yes | Orders, circulars, enforcement |
| Economic Times Markets | `https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms` | RSS | Yes | High-volume market news |
| LiveMint Markets | `https://www.livemint.com/rss/markets` | RSS | Yes | Market/news + macro linkage |
| Business Standard Markets | `https://www.business-standard.com/rss/markets-106.rss` | RSS | Yes | Useful structured market updates |
| The Hindu Business | `https://www.thehindu.com/business/feeder/default.rss` | RSS | Yes | Broad business coverage |
| BusinessLine | `https://www.thehindubusinessline.com/feeder/default.rss` | RSS | Yes | India business + policy focus |

## 2A) `plenaryapp/awesome-rss-feeds` India pack (your link)

Source repo: `https://github.com/plenaryapp/awesome-rss-feeds?tab=readme-ov-file#-India`

Direct import files:

- With categories: `https://raw.githubusercontent.com/spians/awesome-RSS-feeds/master/countries/with_category/India.opml`
- Without categories: `https://raw.githubusercontent.com/spians/awesome-RSS-feeds/master/countries/without_category/India.opml`

Use these OPML files for rapid bootstrap, then filter down to market-relevant feeds.

### Market-relevant picks from India OPML

| Feed | URL | Current status | Notes |
|---|---|---|---|
| SEBI RSS Feed | `https://www.sebi.gov.in/sebirss.xml` | Works | Keep in core set |
| Times of India Top Stories | `https://timesofindia.indiatimes.com/rssfeedstopstories.cms` | Works | High volume, broad news |
| The Hindu Home | `https://www.thehindu.com/feeder/default.rss` | Works | Good general India signal |
| India Today Home | `https://www.indiatoday.in/rss/home` | Works | Fast-moving general + policy stories |
| Business Standard Home Top Stories | `https://www.business-standard.com/rss/home_page_top_stories.rss` | Works | Business-heavy |
| Economic Times Default | `https://economictimes.indiatimes.com/rssfeedsdefault.cms` | Works | Use ET Markets feed for cleaner market alpha |
| ThePrint | `https://theprint.in/feed/` | Works | Policy/politics context feed |
| Scroll | `http://feeds.feedburner.com/ScrollinArticles.rss` | Works | Public-interest + policy context |
| BusinessLine Home | `https://www.thehindubusinessline.com/feeder/default.rss` | Works | Already in core set |
| Financial Express | `https://www.financialexpress.com/feed/` | Partial | Often resolves to HTML in automation; use with fallback parser |
| Moneycontrol Latest News | `http://www.moneycontrol.com/rss/latestnews.xml` | Blocked | Commonly returns 403 for automated fetch |
| Indian Express Front Page | `http://indianexpress.com/print/front-page/feed/` | Unstable | Often returns page HTML; treat as optional |

Practical filter rule for this OPML: keep feeds where `status in (Works, Partial)` and `business/policy relevance >= medium`.

## 3) Free High-Signal Sources (API/HTML, non-RSS)

| Source | URL | Type | Free | Notes |
|---|---|---|---|---|
| NSE Corporate Announcements | `https://www.nseindia.com/api/corporate-announcements?index=equities` | JSON API | Yes | High-value disclosure stream |
| NSE Circulars | `https://www.nseindia.com/api/circulars` | JSON API | Yes | Exchange/regulatory circular stream |
| NSE Corporate Filings Page | `https://www.nseindia.com/companies-listing/corporate-filings-announcements` | HTML | Yes | Backup when API changes |
| NSE Circular Page | `https://www.nseindia.com/resources/exchange-communication-circulars` | HTML | Yes | Backup and browsing |
| BSE Corporate Announcements | `https://www.bseindia.com/corporates/ann.html` | HTML | Yes | Important exchange disclosure source |
| CPPP eProcure | `https://eprocure.gov.in/eprocure/app` | HTML | Yes | Active tenders, bid awards, corrigendum |
| GeM (Govt e-Marketplace) | `https://gem.gov.in/` | HTML | Yes | Bid opportunities and procurement shifts |
| IREPS (Indian Railways) | `https://www.ireps.gov.in/` | HTML | Yes | Rail infra and contract momentum |
| eGazette (GoI) | `https://egazette.gov.in/` | HTML/PDF index | Yes | Legal notifications with strong policy impact |
| DGFT Portal | `https://www.dgft.gov.in/CP/` | HTML | Yes | Trade notices, policy, export/import controls |
| RBI Notifications Page | `https://www.rbi.org.in/Scripts/NotificationUser.aspx` | HTML | Yes | Backup to RSS |
| MCA Latest News | `https://www.mca.gov.in/content/mca/global/en/notifications-tender/news-updates/latest-news.html` | HTML | Yes | Corporate law/filing regime updates |
| GST Portal | `https://www.gst.gov.in/` | HTML | Yes | Tax process and compliance changes |
| CBIC Tax Portal | `https://taxinformation.cbic.gov.in/` | Web app | Yes | Customs/GST notifications (web-app parsing needed) |

## 4) X (Twitter) Watchlist (Free)

Note: direct automated scraping from `x.com` can fail depending on environment. Keep these as monitored handles and ingest via approved methods/tools.

| Handle | URL | Status |
|---|---|---|
| `@PIB_India` | `https://x.com/PIB_India` | Official govt news channel |
| `@RBI` | `https://x.com/RBI` | Official RBI handle |
| `@SEBI_India` | `https://x.com/SEBI_India` | Official SEBI handle |
| `@FinMinIndia` | `https://x.com/FinMinIndia` | Finance ministry updates |
| `@NSEIndia` | `https://x.com/NSEIndia` | Exchange updates |
| `@BSEIndia` | `https://x.com/BSEIndia` | Exchange updates |
| `@dgftindia` | `https://x.com/dgftindia` | DGFT updates |
| `@PiyushGoyal` | `https://x.com/PiyushGoyal` | Trade/industry policy cues |
| `@DPIITGoI` | `https://x.com/DPIITGoI` | Industrial policy cues |
| `@RailMinIndia` | `https://x.com/RailMinIndia` | Rail capex/tender sentiment |
| `@GeM_India` | `https://x.com/GeM_India` | Needs manual verify |
| `@MORTHIndia` | `https://x.com/MORTHIndia` | Needs manual verify |

## 5) LinkedIn Watchlist (Free)

| Organization | URL | Status |
|---|---|---|
| SEBI | `https://www.linkedin.com/company/sebi/` | Verified |
| NSE India | `https://www.linkedin.com/company/national-stock-exchange-of-india-limited/` | Verified |
| BSEIndia | `https://www.linkedin.com/company/bseindia/` | Verified |
| Invest India | `https://www.linkedin.com/company/invest-india/` | Verified |
| Ministry Of Corporate Affairs | `https://www.linkedin.com/company/ministry-of-corporate-affairs/` | Verified |
| Government of India (GoI) | `https://www.linkedin.com/company/government-of-india-goi` | Verified |
| RBI company page | Search `Reserve Bank of India (RBI)` on LinkedIn | Needs manual verify |
| Ministry of Finance page | Search `Ministry of Finance India` on LinkedIn | Needs manual verify |

## 6) Google News RSS Fallback Templates (Free, useful for non-RSS sites)

Use these when an official site has no reliable RSS/API.

- `https://news.google.com/rss/search?q=RBI+site:rbi.org.in`
- `https://news.google.com/rss/search?q=SEBI+site:sebi.gov.in`
- `https://news.google.com/rss/search?q=DGFT+site:dgft.gov.in`
- `https://news.google.com/rss/search?q=eprocure+site:eprocure.gov.in`
- `https://news.google.com/rss/search?q=CPPP+tender+India`
- `https://news.google.com/rss/search?q=NSE+circular+site:nseindia.com`

## 7) Signal Library (What to Extract on Day-1)

### A) Policy/Circular Signals

1. `policy_shock_score`: weighted keywords (`ban`, `mandatory`, `increase`, `cap`, `subsidy`, `PLI`, `duty`, `tax`).
2. `policy_scope`: sector-local vs broad-economy.
3. `effective_date_gap`: days from announcement to implementation.
4. `regulator_intensity`: central bank/regulator/line ministry weight.

### B) Tender/Procurement Signals

1. `tender_value_surprise`: current tender value vs 90-day median for same buyer/sector.
2. `corrigendum_rate`: corrigendum count per tender as uncertainty proxy.
3. `award_to_ticker_map`: winning entity to listed parent/subsidiary map.
4. `procurement_velocity`: number of new tenders by ministry/PSU/day.

### C) Exchange Disclosure Signals

1. `filing_type_alpha`: board meeting/result/order win/fund raise/pledge/default.
2. `disclosure_novelty`: cosine/Jaccard novelty vs issuer’s last 180-day filings.
3. `file_size_jump`: unusually large attachments often indicate material events.
4. `post_filing_move`: realized move windows (15m/1D/1W) for model labels.

### D) News + Social Signals

1. `headline_sentiment` (finance-tuned).
2. `entity_cooccurrence` (ticker + ministry/regulator in same item).
3. `cross_source_confirmation` (same event seen in >=2 independent sources).
4. `social_acceleration` (handle post velocity vs 30-day baseline).

### E) Trust/Quality Signals (must-have)

1. `source_reliability_tier` (official regulator > exchange > mainstream media > social).
2. `dedupe_hash_rate` (duplicate suppression).
3. `mapping_confidence` (event -> ticker confidence).
4. `explainability_bundle` (source URL + snippet + reason code attached to every prediction).

## 8) One-Day Pickup Plan (Minimal but workable)

### Hour 0-2
- Wire RSS ingest for PIB, RBI, SEBI, ET, Mint, BS, Hindu, BusinessLine.

### Hour 2-5
- Wire JSON pulls for NSE APIs (`corporate-announcements`, `circulars`).

### Hour 5-8
- Add HTML pollers for CPPP, GeM, IREPS, eGazette, DGFT.

### Hour 8-10
- Add dedupe + entity extraction + keyword policy/tender classifiers.

### Hour 10-12
- Add basic scoring (`policy_shock_score`, `tender_value_surprise`, `filing_type_alpha`) and terminal ranking output.

## 9) Practical Notes

- Some sites (especially social and a few news pages) use anti-bot controls; keep retry/backoff and browser-like headers where permitted.
- Keep polling intervals source-aware: high-frequency (NSE API: 1-3 min), medium (PIB/RBI/SEBI: 5-10 min), lower (tender portals: 10-20 min).
- Keep a strict provenance log for every signal row: `source`, `url`, `published_at`, `ingested_at`, `hash`, `parser_version`.

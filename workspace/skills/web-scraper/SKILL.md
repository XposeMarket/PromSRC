---
name: Web Scraper
description: Scrape websites and extract structured data using Playwright or Puppeteer. Use for any task involving browsing web pages programmatically, extracting text/links/tables, handling JavaScript-rendered content, avoiding bot detection, or crawling multiple pages politely. Triggers on: scrape, crawl, extract from website, browse page, get data from site, parse HTML, playwright, puppeteer, spider, web extraction, screenshot page, automation browser.
emoji: 🕷️
version: 1.0.0
triggers: scrape, crawl, extract from website, browse page, get data from site, parse HTML, playwright, puppeteer, spider, web extraction, screenshot, automate browser, fetch page content, harvest data
---

# Web Scraper

Structured patterns for scraping websites correctly — without getting blocked, without hammering servers.

---

## Tool Choice

| Situation | Use |
|---|---|
| Quick page content | `web_fetch(url)` — Prometheus built-in, no code needed |
| Interactive scraping (login, click, scroll) | Prometheus `browser_*` tools — see `browser-automation-playbook` skill |
| Static HTML (no JS required) | Python `requests` + `BeautifulSoup` |
| JavaScript-rendered content | Python `playwright` (preferred) or `puppeteer` |
| Already have HTML string | Python `BeautifulSoup` only |
| Need screenshots | `desktop_screenshot()` or Python `playwright` |

**Prefer built-in Prometheus tools first.** Use `web_fetch` for simple reads, `browser_open` + `browser_get_page_text` for complex pages. Only write Python scripts when you need batch processing, complex parsing, or data transformation that the built-in tools can't handle.

---

## 1. Static Pages — requests + BeautifulSoup

```python
import requests
from bs4 import BeautifulSoup
import time

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "en-US,en;q=0.9",
}

def fetch_page(url, retries=3):
    for attempt in range(retries):
        try:
            resp = requests.get(url, headers=HEADERS, timeout=15)
            resp.raise_for_status()
            return BeautifulSoup(resp.text, "html.parser")
        except Exception as e:
            if attempt == retries - 1:
                raise
            time.sleep(2 ** attempt)

# Extract data
soup = fetch_page("https://example.com")
title = soup.select_one("h1").get_text(strip=True)
links = [a["href"] for a in soup.select("a[href]")]
table_rows = soup.select("table tbody tr")
```

---

## 2. JavaScript Pages — Playwright (Python)

```python
from playwright.sync_api import sync_playwright
import time

def scrape_with_playwright(url):
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0",
            viewport={"width": 1280, "height": 800},
        )
        page = context.new_page()

        # Block images/fonts to speed up
        page.route("**/*.{png,jpg,jpeg,gif,webp,woff,woff2}", lambda route: route.abort())

        page.goto(url, wait_until="networkidle", timeout=30000)
        time.sleep(1)  # let any final JS settle

        # Extract
        title = page.title()
        text = page.inner_text("body")
        html = page.content()

        browser.close()
        return {"title": title, "text": text, "html": html}
```

### Install Playwright
```bash
pip install playwright
playwright install chromium
```

---

## 3. Anti-Bot Handling

### Common blocks and fixes:
| Block Type | Fix |
|---|---|
| User-Agent check | Set realistic browser UA (see above) |
| JS fingerprinting | Use Playwright with `stealth` plugin |
| IP block | Rotate requests, add delays, use proxy |
| Cookie wall | Set cookies manually or handle consent clicks |
| CAPTCHA | Use manual solve service or avoid the page |
| Rate limit | See polite crawling section below |

### Playwright Stealth (harder to detect)
```python
# pip install playwright-stealth
from playwright_stealth import stealth_sync

page = context.new_page()
stealth_sync(page)
page.goto(url)
```

### Randomize delays
```python
import random

def polite_delay(min_sec=1.0, max_sec=4.0):
    time.sleep(random.uniform(min_sec, max_sec))
```

---

## 4. Polite Crawling (rate-limiting yourself)

```python
from collections import defaultdict
import time

class PoliteCrawler:
    def __init__(self, delay_per_domain=2.0):
        self.delay = delay_per_domain
        self.last_visit = defaultdict(float)

    def wait(self, url):
        from urllib.parse import urlparse
        domain = urlparse(url).netloc
        elapsed = time.time() - self.last_visit[domain]
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed + random.uniform(0, 0.5))
        self.last_visit[domain] = time.time()

crawler = PoliteCrawler(delay_per_domain=2.0)

for url in urls_to_scrape:
    crawler.wait(url)
    data = fetch_page(url)
    # process...
```

---

## 5. Structured Extraction Patterns

### Extract a table
```python
def extract_table(soup, table_selector="table"):
    table = soup.select_one(table_selector)
    if not table:
        return []
    headers = [th.get_text(strip=True) for th in table.select("thead th, tr:first-child th")]
    rows = []
    for tr in table.select("tbody tr"):
        cells = [td.get_text(strip=True) for td in tr.select("td")]
        if cells and headers:
            rows.append(dict(zip(headers, cells)))
    return rows
```

### Extract all links (absolute)
```python
from urllib.parse import urljoin

def extract_links(soup, base_url):
    return [urljoin(base_url, a["href"]) for a in soup.select("a[href]")
            if not a["href"].startswith(("#", "mailto:", "javascript:"))]
```

### Extract structured fields
```python
def extract_listing(soup):
    return {
        "title": (soup.select_one(".title, h1") or soup.select_one("title")).get_text(strip=True),
        "price": soup.select_one(".price, [data-price]").get_text(strip=True) if soup.select_one(".price, [data-price]") else None,
        "description": soup.select_one(".description, .body, article").get_text(strip=True) if soup.select_one(".description, .body, article") else None,
    }
```

---

## 6. Saving Scraped Data

```python
import json, csv
from pathlib import Path

# JSON
def save_json(data, path):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)

# CSV
def save_csv(rows, path):
    if not rows:
        return
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=rows[0].keys())
        writer.writeheader()
        writer.writerows(rows)
```

---

## 7. Pre-Scrape Checklist

Before writing any scraper:
- [ ] Is scraping allowed? Check `robots.txt` at `site.com/robots.txt`
- [ ] Is the content static or JS-rendered? (View Source vs. Inspect Element)
- [ ] What's the rate limit strategy? (default: 2s between requests per domain)
- [ ] What fields need to be extracted? What are the CSS selectors?
- [ ] What's the output format and destination?
- [ ] Are there pagination or infinite scroll elements to handle?
- [ ] Will login/cookies be required?

---

## 8. Ethics Rules

- ✅ Always respect `robots.txt` Disallow rules
- ✅ Identify yourself in User-Agent if scraping at scale
- ✅ Cache results — don't re-request pages you already have
- ✅ Default to 2+ second delays between requests on the same domain
- ❌ Never scrape at a rate that degrades the target server
- ❌ Never scrape behind a login without permission
- ❌ Never store or share personal data scraped from public pages without legal basis

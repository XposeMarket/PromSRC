---
name: API Integration
description: Correctly call REST APIs and web services. Use for any HTTP requests, authentication (Bearer token, API key, OAuth), JSON parsing, rate limit handling (429 errors), pagination, webhooks, or building any API client. Triggers on: API, REST, HTTP, endpoint, Bearer token, API key, OAuth, rate limit, pagination, JSON response, webhook, connect to service, call API, fetch data from.
emoji: 🔌
version: 1.0.0
triggers: API, REST, HTTP, endpoint, Bearer, API key, OAuth, rate limit, 429, pagination, JSON, webhook, connect to, call endpoint, fetch data, integrate with, POST request, GET request, auth header
---

# API Integration

A practical reference for calling REST APIs reliably. Don't write API code from memory — use this.

---

## 1. Authentication Patterns

### API Key (Header)
```python
headers = {
    "X-API-Key": os.environ.get("API_KEY"),
    "Content-Type": "application/json"
}
```

### Bearer Token
```python
headers = {
    "Authorization": f"Bearer {token}",
    "Content-Type": "application/json"
}
```

### Basic Auth
```python
import requests
response = requests.get(url, auth=("username", "password"))
```

### OAuth 2.0 (Client Credentials)
```python
def get_oauth_token(token_url, client_id, client_secret):
    resp = requests.post(token_url, data={
        "grant_type": "client_credentials",
        "client_id": client_id,
        "client_secret": client_secret
    })
    resp.raise_for_status()
    return resp.json()["access_token"]
```

### ⚠️ Secret Safety
- Never hardcode secrets in source files
- Always use `os.environ.get("API_KEY")`
- Use `.env` + `python-dotenv` locally; secret managers in production

---

## 2. Making Requests

```python
import requests

# GET with query params
response = requests.get(
    "https://api.example.com/items",
    headers=headers,
    params={"page": 1, "limit": 100},
    timeout=10
)

# POST with JSON body
response = requests.post(
    "https://api.example.com/items",
    headers=headers,
    json={"name": "thing", "value": 42}
)

response.raise_for_status()  # raises on 4xx/5xx
data = response.json()
```

### Session (reuse connections + headers)
```python
session = requests.Session()
session.headers.update({"Authorization": f"Bearer {token}"})
r1 = session.get("https://api.example.com/a")
r2 = session.get("https://api.example.com/b")
```

---

## 3. Error Handling

```python
from requests.exceptions import HTTPError, ConnectionError, Timeout

try:
    response = requests.get(url, headers=headers, timeout=10)
    response.raise_for_status()
    return response.json()

except HTTPError as e:
    status = e.response.status_code
    if status == 401:
        raise Exception("Auth failed — check API key/token")
    elif status == 403:
        raise Exception("Forbidden — check permissions/scopes")
    elif status == 404:
        raise Exception(f"Not found: {url}")
    elif status == 422:
        raise Exception(f"Validation error: {e.response.json()}")
    elif status == 429:
        raise  # handled by retry logic below
    else:
        raise Exception(f"HTTP {status}: {e.response.text[:200]}")

except ConnectionError:
    raise Exception("Cannot connect — check URL and network")
except Timeout:
    raise Exception("Request timed out after 10s")
```

---

## 4. Rate Limit Retry (429)

```python
import time, random

def api_request_with_retry(url, headers, max_retries=5, **kwargs):
    for attempt in range(max_retries):
        response = requests.get(url, headers=headers, timeout=10, **kwargs)

        if response.status_code == 429:
            retry_after = response.headers.get("Retry-After")
            wait = int(retry_after) if retry_after else (2 ** attempt) + random.uniform(0, 1)
            print(f"Rate limited. Waiting {wait:.1f}s (attempt {attempt+1}/{max_retries})")
            time.sleep(wait)
            continue

        response.raise_for_status()
        return response.json()

    raise Exception(f"Max retries ({max_retries}) exceeded")
```

---

## 5. Pagination

### Offset / Page-based
```python
def fetch_all_pages(base_url, headers, page_size=100):
    results, page = [], 1
    while True:
        resp = requests.get(base_url, headers=headers,
                            params={"page": page, "per_page": page_size})
        resp.raise_for_status()
        items = resp.json().get("items", [])
        if not items:
            break
        results.extend(items)
        if len(items) < page_size:
            break
        page += 1
    return results
```

### Cursor / Token-based
```python
def fetch_all_cursor(base_url, headers):
    results, cursor = [], None
    while True:
        params = {"limit": 100}
        if cursor:
            params["cursor"] = cursor
        resp = requests.get(base_url, headers=headers, params=params)
        resp.raise_for_status()
        data = resp.json()
        results.extend(data["items"])
        cursor = data.get("next_cursor") or data.get("next_page_token")
        if not cursor:
            break
    return results
```

### Link Header-based (GitHub style)
```python
import re

def fetch_all_link(first_url, headers):
    results, url = [], first_url
    while url:
        resp = requests.get(url, headers=headers)
        resp.raise_for_status()
        results.extend(resp.json())
        match = re.search(r'<([^>]+)>;\s*rel="next"', resp.headers.get("Link", ""))
        url = match.group(1) if match else None
    return results
```

---

## 6. Async (high-throughput)

```python
import asyncio, aiohttp

async def fetch_many(urls, headers):
    async with aiohttp.ClientSession(headers=headers) as session:
        tasks = [fetch_one(session, url) for url in urls]
        return await asyncio.gather(*tasks, return_exceptions=True)

async def fetch_one(session, url):
    async with session.get(url) as resp:
        resp.raise_for_status()
        return await resp.json()

results = asyncio.run(fetch_many(urls, headers))
```

---

## 7. Pre-Integration Checklist

Before writing any API integration code:
- [ ] Where does the key/token come from? (`os.environ.get`)
- [ ] Is there a sandbox/test environment URL?
- [ ] What auth method? (Bearer / API key / OAuth)
- [ ] What are the rate limits? What's the retry plan?
- [ ] Does the endpoint paginate? Which pattern?
- [ ] What does the response JSON look like? (check docs or `print(json.dumps(resp.json(), indent=2))`)
- [ ] Which HTTP errors need special handling?

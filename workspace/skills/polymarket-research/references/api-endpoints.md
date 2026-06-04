# Polymarket API Endpoints Reference

All endpoints are public REST `GET`, return JSON, and need no authentication.

## Gamma API — `gamma-api.polymarket.com`

### Search Markets

```http
GET /public-search?q=QUERY
```

Response shape:

```json
{
  "events": [
    {
      "id": "12345",
      "title": "Event title",
      "slug": "event-slug",
      "volume": 1234567.89,
      "markets": [
        {
          "question": "Will X happen?",
          "outcomePrices": "[\"0.65\", \"0.35\"]",
          "outcomes": "[\"Yes\", \"No\"]",
          "clobTokenIds": "[\"TOKEN_YES\", \"TOKEN_NO\"]",
          "conditionId": "0xabc...",
          "volume": 500000
        }
      ]
    }
  ],
  "pagination": {"hasMore": true, "totalResults": 100}
}
```

### List Events

```http
GET /events?limit=N&active=true&closed=false&order=volume&ascending=false
```

Parameters:

- `limit` — max results.
- `offset` — pagination offset.
- `active` — true/false.
- `closed` — true/false.
- `order` — `volume`, `createdAt`, `updatedAt`.
- `ascending` — true/false.
- `tag` — filter by tag slug.
- `slug` — get a specific event by slug.

### List Markets

```http
GET /markets?limit=N&active=true&closed=false&order=volume&ascending=false
```

Same filters as events, plus `slug` for a specific market.

Important fields: `id`, `question`, `conditionId`, `slug`, `description`, `outcomes`, `outcomePrices`, `volume`, `liquidity`, `active`, `closed`, `marketType`, `clobTokenIds`, `endDate`, `category`, `createdAt`.

### List Tags

```http
GET /tags
```

Use tag `slug` values for filtering.

## CLOB API — `clob.polymarket.com`

All CLOB price endpoints use `token_id` from a market's `clobTokenIds` field. Index 0 is usually Yes, index 1 No.

### Current Price

```http
GET /price?token_id=TOKEN_ID&side=buy
```

### Midpoint Price

```http
GET /midpoint?token_id=TOKEN_ID
```

### Spread

```http
GET /spread?token_id=TOKEN_ID
```

### Orderbook

```http
GET /book?token_id=TOKEN_ID
```

### Price History

```http
GET /prices-history?market=CONDITION_ID&interval=INTERVAL&fidelity=N
```

Parameters:

- `market` — `conditionId`, hex string with `0x` prefix.
- `interval` — `all`, `1d`, `1w`, `1m`, `3m`, `6m`, `1y`.
- `fidelity` — number of data points.

### CLOB Markets List

```http
GET /markets?limit=N
```

## Data API — `data-api.polymarket.com`

### Recent Trades

```http
GET /trades?limit=N
GET /trades?market=CONDITION_ID&limit=N
```

### Open Interest

```http
GET /oi?market=CONDITION_ID
```

## Field Cross-Reference

1. Get market from Gamma; it has `clobTokenIds` and `conditionId`.
2. Parse `clobTokenIds` JSON string into `[YES_TOKEN, NO_TOKEN]`.
3. Use the Yes token with `/price`, `/book`, `/midpoint`, `/spread`.
4. Use `conditionId` with `/prices-history` and Data API endpoints.

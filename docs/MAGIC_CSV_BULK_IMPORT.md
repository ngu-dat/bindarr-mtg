# Magic CSV Bulk Import

Bindarr 1.9.0 already imports Magic CSVs into the signed-in user's collection
from Settings. This page adds the administrator flow: import a ManaBox-style
Magic collection CSV into any existing Bindarr account at `/bulkimport`.

## Using the page

1. Sign in with an administrator account and open `/bulkimport`.
2. Choose the target user.
3. Select a `.csv` file and review the valid row/copy counts, row errors, and
   unsupported columns.
4. Select **Import** to add the matched copies.

The import is additive. Re-importing the same file adds the same copies again;
it does not replace or deduplicate the target user's collection.

## CSV and data behavior

The parser handles UTF-8 BOM, CRLF, quoted commas, escaped quotes, and quoted
line breaks. Files are limited to 5 MiB, 5,000 rows, and 25,000 total copies.
Invalid rows are excluded and reported by line number. The CSV needs `Quantity`
and either `Scryfall ID` or both `Set code` and `Collector number`.

Scryfall ID is preferred to identify the exact printing; set code plus collector
number is the fallback. Name-only matches are deliberately not used. Existing
CSV mapping converts foil, condition, and language into Bindarr's stored values.
Numeric purchase price and a valid `Added` timestamp are saved per copy. Scryfall
provides the card name, rarity, set metadata, image, and market data. Quantity is
expanded to one collection row per physical copy.

These supplied fields are reported as unsupported because the collection model
does not store them: `Misprint`, `Altered`, `Signed`, `Proxy`, `ManaBox ID`, and
`Purchase price currency`. Purchase price is kept as a number without its
currency.

Invalid rows are skipped, and valid rows that Scryfall cannot match are counted
as unmatched. Collection inserts are committed in a single transaction. Card
metadata may be cached before the transaction; if collection insertion fails,
the transaction rolls back without partial copies.

## Endpoints and access control

- `POST /api/admin/users/:id/mtg-import/preview`
- `POST /api/admin/users/:id/mtg-import`

Both endpoints are behind the admin router's session and administrator-role
checks. The import endpoint is rate-limited by Bindarr's existing import limit.
The page is an SPA path, so it needs no Caddy-specific route. Device mode already
returns `501` for `/api/admin` and remains unchanged.

## Tests

```sh
cd backend && node test/magicbulkimport.test.js
cd backend && node test/magicbulkimport-api.test.js
cd frontend && npm run build && npm run lint && npm run check:locales
```

The API test uses a temporary SQLite database and a stubbed Scryfall response;
it checks admin/member access, target-user scoping, additive imports, unmatched
rows, and transaction rollback.

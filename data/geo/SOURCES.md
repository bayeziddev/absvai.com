# Geo data sources (pinned)

| File in `source/bangladesh-geocode/` | Upstream path | Rows |
|---|---|---:|
| `divisions.json` | `divisions/divisions.json` | 8 |
| `districts.json` | `districts/districts.json` (with lat/lon) | 64 |
| `upazilas.json` | `upazilas/upazilas.json` | 494 |
| `unions.json` | `unions/unions.json` (key is spelled `upazilla_id`) | 4,540 |
| `postcode.csv` | `postcode-bd/postcode.csv` (division, district, thana, post office, postcode) | 1,349 |
| `districts.geojson.txt` | `geojson/districts.geojson.txt` (64 `MultiPolygon` district outlines) | 64 |
| `LICENSE` | `LICENSE` (MIT) | |

- Upstream: https://github.com/bayeziddev/Bangladesh-geocode
- Pinned commit: `c97c6945b018349050496070d982444b7aadfbbf` (2026-10-30)

## Facts checked against the files, not the docs

- Dhaka **division** id is `6` in `divisions.json`. The upstream README's PHP example filters Dhaka with `'1'`, which is Chattagram.
- Dhaka **district** id is `47`.
- `districts.json` spells Comilla `Comilla`; `districts.csv` spells it `Cumilla`. We import the JSON.
- `postcode.csv` uses the pre-2015 seven-division layout (no Mymensingh) and Wikipedia spellings
  (Chittagong, Jessore, Bogra, Barishal, …). The import resolves every postcode district through an alias table and takes
  the division from the matched district.
- The outline file uses a third set of spellings (`Nawabganj` = Chapainawabganj, `Brahamanbaria`, `Jhalokati`, …).
- The source has some typos of its own, e.g. upazila 260 is `Borhan Sddin` (Borhanuddin).

## Licensing to confirm before launch

Bangladesh-geocode is MIT licensed. Its `postcode-bd` folder was produced by `postcode-bd/bdpostcode.php`, which scrapes
Wikipedia's "List of postal codes in Bangladesh". Wikipedia text is CC BY-SA 4.0. Postcode facts themselves are generally
not copyrightable, but keep the attribution line in the site footer's credits page and confirm with the client.

## Regenerating

```bash
npm run gen:geo      # writes worker/migrations/0002_geo_data.sql, data/geo/generated/*, data/geo/reports/*
```

Only regenerate before the first production migration. After launch, postcode fixes are made in admin
(they live in D1), and any new upstream data goes in as a new, additive migration.

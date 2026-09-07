# Rail & Rack — League Standings Site

A static, GitHub Pages–ready website for the pool league. It reads
`data/league.db` (a SQLite database matching the provided schema) directly
in the visitor's browser using [sql.js](https://sql.js.org) — no backend,
no build step.

## How it works

- `data/league.db` is your league database, matching `schema.sql`.
- `js/app.js` loads it client-side with `vendor/sql-wasm.js` /
  `vendor/sql-wasm.wasm` (a bundled, offline copy of sql.js — no CDN
  dependency) and runs the same views defined in the schema
  (`v_alltime_standings`, `v_alltime_standings_active`,
  `v_semester_standings`, `v_player_elo_timeline`).
- The page renders three leaderboard views (All-time, Active players, By
  semester) and a per-player detail page with an Elo history chart and
  recent match list.

## Updating the data every week

1. Export your updated database as `league.db` (same schema as
   `schema.sql`).
2. Replace `data/league.db` in this repository with the new file.
3. Commit and push. GitHub Pages will serve the new file on the next
   deploy — nothing else needs to change.

```bash
cp /path/to/your/league.db data/league.db
git add data/league.db
git commit -m "Update league results"
git push
```

No HTML/CSS/JS edits are ever required for a data update — the site reads
whatever is in `data/league.db` at load time.

## Hosting on GitHub Pages

1. Push this folder's contents to a repository (root, or a `/docs`
   folder — either works, just set the Pages source accordingly).
2. In the repo, go to **Settings → Pages** and set the source branch
   (and folder, if using `/docs`).
3. Your site will be live at `https://<username>.github.io/<repo>/`.

The included `.nojekyll` file tells GitHub Pages to skip Jekyll
processing, which matters because Jekyll ignores files/folders starting
with an underscore and can otherwise interfere with serving the `.wasm`
file correctly.

## Local preview

Because the browser fetches `data/league.db` and the `.wasm` file, you
need to serve the folder over HTTP (not open `index.html` directly via
`file://`). From this folder:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

## File structure

```
index.html          Page markup
css/styles.css       Design system + layout
js/app.js            Loads league.db and renders everything
vendor/sql-wasm.js   sql.js library (bundled, no CDN needed)
vendor/sql-wasm.wasm sql.js WebAssembly binary
data/league.db       Your league database — replace weekly
schema.sql           Reference copy of the database schema
```

## Notes on the schema

- **All-time / Active tabs** rank by current Elo and show career points,
  wins, losses, byes, and matches played.
- **Semester tab** ranks by semester points (ties broken by Elo), and the
  dropdown lists every semester on record, most recent first.
- Clicking any player row opens their detail page: lifetime Elo history
  chart (built from `elo_history` via `v_player_elo_timeline`) and their
  15 most recent matches.
- Players marked inactive (`is_active = 0`) still appear in the All-time
  view (with a small marker) but are excluded from the Active view.

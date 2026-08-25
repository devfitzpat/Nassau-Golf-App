# Nassau Golf App — Full Review

*Bugs, reliability, security, UI/UX, and recommendations · reviewed 2026-08-25*
*Scope: `nassau-index.html` (app), `nassau-worker.js` (API proxy), `index.html` (redirect), `nassau-SETUP.md` (guide)*

Every factual claim below was checked against the actual code (line numbers refer to the current files), and the highest-impact findings were independently re-verified. Findings are grouped by theme; severity is called out inline. A prioritized roadmap is at the end.

---

## First, what you got right

For a first app build, there is a lot here worth keeping — these are good instincts, not accidents:

- **The API key never touches the client.** Routing Anthropic calls through a Cloudflare Worker with the key in a secret is exactly the right architecture. Most first projects hardcode the key in the page.
- **Round persistence exists at all.** Mirroring state to `localStorage` on every change so a reload or phone call can't erase a round is a real product insight — most scorecard apps get this wrong. (The gaps are in the edges, covered below, but the design is right.)
- **The handicap engine is correct.** `courseHcp()` implements the real WHS formula (index × slope/113 + rating − par), `strokesOn()` allocates by stroke index and even handles plus-handicaps and CH > 18 — this math checked out under review.
- **The best-ball optimizer is genuinely clever.** `teamScore()` exhaustively searches net/gross role assignments to find the optimal combination — that's the correct way to score "best N net + M gross," and many commercial apps fake it greedily.
- **Design tokens, iterative "field passes" for sunlight legibility, safe-area insets, 44px+ tap targets** — you were designing for the actual context of use (bright sun, on a tee box, big thumbs). That's product thinking.
- **The Anthropic API call is current and correct** — `claude-opus-5`, `output_config: {effort: 'low'}`, image-before-text content ordering, and a sensible `max_tokens` are all the right shapes.

The problems below cluster into a few root causes, each of which is a general lesson — noted as **Lesson** boxes as they come up.

---

## 1 · Money bugs (the settlement can be wrong)

These are the most important findings: cases where the app pays out the wrong dollars with no warning.

### 1.1 CRITICAL — Missing scores silently award holes, segments, and skins
`nassau-index.html:1769-1778` (`allHoles`), plus `2034-2037`, `1595-1617`, `1290`, `1800-1807`

`allHoles()` drops teams with a null total from the comparison and lets whoever's left win the hole outright. Nothing anywhere checks completeness before money is computed:

- **Photo mode:** the AI prompt explicitly says "use null for illegible scores" (line 1290), so nulls are a *normal* outcome — and one illegible hole can hand that hole, a $1 segment, and a carried skins pot to the other team.
- **Manual mode:** the single-pane scoring screen shows one team at a time. Forget to switch tabs on one hole before "Finish Round" and the entered team wins that hole — the live ticker even shows it, wrongly, as a lead.
- The subtler variant (verified): a team with *some* but not all its scores entered gets a **partial total** compared against full totals — a 1-ball ~4 "beats" a 2-ball ~9, so the incomplete team wins instead.

**Fix:** in `allHoles()`, only declare a winner when every team has a complete total; before results, list incomplete holes and require explicit confirmation ("Scores missing on holes 6, 11 — settle anyway?"). Mark incomplete holes on the progress track.

### 1.2 CRITICAL — The skins Gross/Net setting does nothing
`nassau-index.html:1800-1807`

`skins()` reuses the same per-hole winners as the Nassau — the mixed net+gross team totals. `G.skinsType` is only ever read for labels and the on/off guard (verified by exhaustive grep). Selecting **Gross** vs **Net** skins produces byte-identical results. Whole-team-total skins may even be the rule your group wants — but then the selector shouldn't exist; if you *do* want gross or net skins, they need their own per-hole best-ball comparison with their own carryover.

### 1.3 HIGH — A short-handed team auto-wins
`nassau-index.html:1760`, setup validation at `1233`

When a team has fewer scoring balls than the format needs (`cands.length < needed`), `teamScore` returns the sum of just the entered balls. With the default 1N+1G, a 1-player team totals ~4–5 per hole against full teams' ~8–10 and sweeps every hole, all three segments, and every skin. Setup happily accepts a 1-player team under a 2-ball format with no warning. **Fix:** return `total: null` when a team can't field the required balls (then 1.1's fix treats the hole as undecided), or warn at setup.

### 1.4 HIGH — Unassigned players silently vanish from the bet
`nassau-index.html:1598-1604`

`confirmTeams()` skips any player left on "— Unassigned —" with no message; with 8–12 pool rows it's easy to miss one. Worse: a player set as **wildcard** for a team but left unassigned as primary is dropped *entirely* — the reconcile screen even displays them on the team card as a wildcard chip, implying they count, right up until they don't. **Fix:** name unassigned players in a confirm before calculating; treat wildcard-set-but-unassigned as a blocking error.

### 1.5 MEDIUM — Typos flow straight into the settlement
`nassau-index.html:1388-1400, 1375-1377, 1170-1172`

The `min`/`max` attributes on review and GHIN inputs are advisory; handlers do no clamping. A fat-fingered "55" (meant "5") loses the hole and dollars with nothing flagging it. Also: typing `0` shows 0 in the box but stores null. **Fix:** clamp in the `onchange` handlers and write the clamped value back to the input.

### 1.6 MEDIUM — AI score arrays shorter than 18 lose the back nine
`nassau-index.html:1323`

`slice(0,18)` never pads short arrays. If the model returns 9 entries (front-nine-only photo), the review screen renders zero back-nine inputs — the holes can't be seen or typed — and settlement treats that foursome as never playing the back. **Fix:** pad to 18 with nulls after slicing.

### 1.7 LOW — Plus-handicaps flip to positive
`nassau-index.html:1321`

`parseFloat('+2.4')` is `+2.4`, so a plus-2.4 player photographed as "+2.4" *receives* ~2 strokes instead of giving one back (~3-stroke net swing). The GHIN inputs (`min="0"`) can't produce a negative either, even though `strokesOn()` handles them correctly. **Fix:** detect a leading `+` in AI-extracted handicaps and negate; allow plus entry in the inputs.

### 1.8 LOW — The prompt may double-convert handicaps
`nassau-index.html:1291`

The prompt says "hcp is the handicap number shown for the player," and the app then runs it through the WHS index→CH conversion. If what's handwritten on your cards is already a *course* handicap (common), it gets converted twice. **Fix:** state your group's convention explicitly in the prompt, or add an index/CH toggle on review.

> **Lesson — validate before money.** Every place a number crosses from "input" to "settlement" deserves a gate: completeness, range, and named exceptions. Golf-bet arguments are the whole reason this app exists; the app should never be a *source* of them.

---

## 2 · Data-loss traps

The persistence layer is well-intentioned, but several one-tap paths destroy work — the most common category of finding in this review.

| # | Trap | Where | What's lost |
|---|------|-------|-------------|
| 2.1 HIGH | Photo-mode `begin()` always runs `G.cards = []` | 1213-1218 | Back out of Upload to tweak a setting, tap "Upload Scorecards →" again: every paid AI read and correction is wiped, and the wipe is immediately saved |
| 2.2 HIGH | `goToReconcile()` rebuilds the pool from scratch | 1446-1452 | Review ↔ Reconcile round trip resets every team assignment and wildcard; modal-added walk-ons are deleted entirely |
| 2.3 HIGH | "← New Round" has no confirmation | 2139, 2146-2150 | One tap on the results screen destroys the round *and* its localStorage backup — before anyone screenshots the settlement |
| 2.4 HIGH | Declining the resume prompt deletes the save | 2186 | Fat-finger "Cancel" on the launch dialog: nine holes of a money game gone, no undo |
| 2.5 HIGH | Upload phase excluded from resume | 2181-2184 | iOS evicts the PWA while photographing cards (it routinely does, camera in foreground): reload offers no resume; saved extractions are unreachable and the next `begin()` overwrites them |
| 2.6 HIGH | Resume + Back = blank dead-end screens | 2203-2207, 911 | Resume at Review, tap Back: upload screen shows zero cards, disabled button — round *looks* lost (data intact), and the only obvious path forward really does destroy it |

**Fixes, in one theme:** make destructive transitions explicit and non-default —
- `begin()` (photo): only reset when `G.cards` is empty; otherwise rebuild the list UI from state, or ask "Discard N uploaded scorecards?"
- `goToReconcile()`: merge instead of rebuild — keep existing pool entries (and always keep `cardIdx: -1` walk-ons) with their assignments, refresh only names/scores from cards.
- `newRound()`: wrap in a confirm; keep a "last round" snapshot under a second localStorage key so the previous settlement stays reopenable.
- Resume decline: *keep the save*, just don't load it; clear only when a new round actually starts.
- Add `'scr-upload'` to `RESUMABLE` and rebuild `#upload-list` from `G.cards` on restore (the placeholder-thumbnail machinery for this already exists); route Back buttons through the screen-builder functions instead of bare `go()`.

> **Lesson — never destroy user data as a side effect of navigation.** Deletion should be (a) explicitly requested, (b) confirmed when it's a lot of work, and ideally (c) soft — keep the old thing recoverable for a while. Notice `newRound()` currently violates all three at once.

---

## 3 · State vs. DOM — one source of truth

A cluster of confirmed bugs share a single root cause: round state lives in **two places** — the `G` object and the DOM — and they're synced *by position*.

- **3.1 HIGH — Mid-round roster edits shift scores to the wrong players** (`1665-1668`, `1221-1237`). `reshapeScores()` remaps by index. Exit to setup mid-round, delete a duplicated player row, resume: every player after the deleted slot inherits the *previous* player's scores, and nets are computed with the wrong handicap. Settlement silently wrong.
- **3.2 HIGH — Resume never re-syncs the setup screen** (`2199-2210`). Restore a round, later tap "← Course & Setup": the setup DOM still shows page-load defaults (Photo, 1N+1G, the hardcoded roster). `begin()` *reads the DOM*, so tapping it silently swaps your real roster and format for the defaults and refits your scores onto them.
- **3.3 HIGH — `newRound()` leaves stale team cards** (`2146-2150`). It empties `G.teams` but not `#manual-teams`: the visible teams' handlers now throw, "Start Round" refuses with "Add at least 2 teams" while two teams sit on screen, and "+ Add Team" creates a duplicate `id="mt-0"` that appends rows into the *old* card. Realistic recovery is a force-reload.
- **3.4 LOW — Row handlers bake indexes at creation** (`1160-1189`). After removing a non-last row, later rows' `onchange`/tee/delete handlers still target old indexes and hit the wrong player in `G`.
- **3.5 LOW — `addManualPlayer` drops its arguments** (`1160-1162`). It pushes `{name:'', hcp:0}` regardless of what was passed; the real values live only in DOM attributes. After a resume-rebuild, the first autosave persists a blank-name/zero-handicap roster over the good save.
- **3.6 MEDIUM — Custom team names reset** (`1196-1202`). `removeManualTeam()` rebuilds via `addManualTeam(t.players)`, which hardcodes `Team ${idx+1}` — renames are lost on any team removal and on mid-setup resume.

**The structural fix** (worth doing once rather than patching six times): make `G` the single source of truth. Give each player a stable `id` at creation; render rows *from state*; on any input event, look up the player by id (or by DOM position at event time) instead of baking indexes into handler strings; make `reshapeScores()` match by id. Then deletion, reordering, resume, and re-render all become safe automatically.

> **Lesson — the DOM is not your database.** This is *the* classic first-app architecture trap, and it produced 6 of the 22 confirmed bugs here. The pattern that fixes it: state → render → events mutate state → re-render. You already do exactly this correctly on the reconcile screen (`renderRecon()`), which is why that screen has no positional bugs.

---

## 4 · Photo / AI pipeline reliability

- **4.1 HIGH — No image downscaling** (`1250-1261`). Raw iPhone photos (commonly 3–8MB; modern default 24MP) are base64'd whole (+33%) and sent as-is. The Anthropic API rejects images over ~5MB, and downscales past ~1568px anyway — so oversized uploads buy failures and slow cellular uploads, never accuracy. **Fix:** draw to a canvas capped at ~1568px long edge, `canvas.toDataURL('image/jpeg', 0.8)` (~200–500KB). This one change also fixes 4.4 (HEIC), speeds every read, and relieves iOS memory pressure from multi-MB data-URLs held in state.
- **4.2 HIGH — Failures are generic, unretryable, and end in silent exclusion** (`1333-1339`, `1344-1347`, `1358`). Every failure collapses to "⚠ Read error" (cause logged only to console; `res.ok`/`data.error` never checked). No card has retry or delete. A hung request stalls "Reading…" for minutes with no recourse. And if you push on, `goToReview` silently skips the errored card — **an entire foursome vanishes from the money** with the only signal left behind on a previous screen. **Fix:** surface `data?.error?.message`, add per-card ↻ retry and × delete, an `AbortController` timeout (~60s), and an explicit warning on "Review Scores →" when any card errored.
- **4.3 MEDIUM — `capture="environment"` blocks the camera roll** (`905`). On iOS this forces the rear camera directly, while the tile's own subtext promises "or choose from camera roll" — and photo mode is explicitly the after-round flow, where the photo may already exist (or was texted to you). **Fix:** drop `capture`, keep `accept="image/*"`; consider `multiple`.
- **4.4 LOW — HEIC/unknown types sent verbatim** (`1257`). `file.type` is forwarded as `media_type`; `image/heic` (Files app, AirDrop) gets a 400 → the same generic error. The canvas re-encode from 4.1 fixes this for free.
- **Improvement — guaranteed-valid JSON:** instead of regex-extracting `{...}` from free text, have the Worker use the API's structured outputs (`output_config.format` with a JSON schema for `{players: [...]}`). No more "No JSON in response" failures, and short/malformed arrays can be rejected by schema instead of handled downstream.

---

## 5 · Security

- **5.1 HIGH — The Worker is an open proxy with a published URL** (`nassau-worker.js:20-67`; URL at `nassau-index.html:1022` in a public repo). Any origin, no auth, no rate limit, and the client-supplied body is forwarded *verbatim* — a caller can run any model at any `max_tokens` on your key. Scanners actively hunt open `workers.dev` LLM proxies. **Fix (do all four):**
  1. Have the client send only `{imageBase64, mediaType}` and build the full Anthropic request (model, max_tokens, prompt) **in the Worker** — the proxy stops being general-purpose.
  2. Check the `Origin` header against your GitHub Pages origin and reflect it instead of `*`.
  3. Reject oversized bodies.
  4. Regardless of the above: set a low monthly spend limit in console.anthropic.com. This is your real backstop.
- **5.2 MEDIUM — Unescaped names in `innerHTML` everywhere** (`1329-1330`, `1370-1373`, `1475`, and ~6 more sinks). Names from the vision model and from users are interpolated raw into HTML and quoted attributes. Realistic case: any stray `<` or `"` the OCR emits garbles rendering or truncates a name into state permanently. Adversarial case: markup handwritten on a photographed card executes script on your github.io origin. **Fix:** a 5-line `esc()` helper wrapping every `${name}`-style sink (escape `& < > " '`), plus stripping `<>"'` when ingesting AI JSON.
- **5.3 LOW — Worker error paths lack CORS + unguarded upstream `json()`** (`nassau-worker.js:30-43, 63`). The 405/400 responses omit `Access-Control-Allow-Origin` so the browser can't read them, and a non-JSON upstream body throws → CORS-less 500. **Fix:** one shared CORS-headers object spread into every response; read upstream as text and `try { JSON.parse }`.

> **Lesson — escape at the boundary.** Any string you didn't write yourself (user input, AI output, URL params) gets escaped the moment it's interpolated into HTML. One tiny helper, used everywhere, closes the whole class.

---

## 6 · UX — flows and interactions

**Confirmed flow gaps:**

- **6.1 HIGH — Results is a one-way door** (`2116-2140`). The standard 19th-hole dispute — "I had a 4 on 14, not 5" — cannot be corrected after Finish Round. All state is intact in `G`; an "Edit Scores" button calling `go('scr-scoring')`/`renderHole()` (manual) or `goToReview()` (photo) is a navigation-only fix.
- **6.2 MEDIUM — The net/gross contributor tags never render** (`1853`). `teamScore` emits contribs keyed `"t0p1"`, but `renderHole` looks up `cm[pi]` with the bare number — always undefined. The feature that shows *whose ball counted* is silently dead on every hole (its CSS and markup are all there). One-line fix: `cm[`t${ti}p${pi}`]`.
- **6.3 MEDIUM — "Overall Winner: Team 1" on a full push** (`2064-2065`). `net.indexOf(max)` crowns the earlier-listed team even when everything tied and the table below shows $0.00s. Show "All Square — no money moves," and co-leaders when top money is shared.
- **6.4 MEDIUM — A score can never be cleared** (`1885-1889`). Once a stepper is tapped there's no path back to blank — a phantom score the best-ball engine may happily select. Add a long-press or × to null it.

**Recommendations (product-level, from the panel's UX reviewers):**

- **6.5 One-tap par.** `adj()` seeds par *then applies the delta*, so the first "+" records bogey — surprising, and it makes the app's hottest interaction its slowest (2+ taps × 8 players × 18 holes of mostly-par golf). Make tapping the score number itself set par; add "fill remaining with par."
- **6.6 Tappable progress dots.** Fixing hole 3 from hole 16 is currently 26 taps. `onclick="G.hole=i;renderHole()"` with a bigger hit area, done.
- **6.7 Remember the roster.** The same eight players re-enter (or silently trust stale hardcoded) GHIN indexes every week; updating defaults requires editing HTML. Persist a roster (name/GHIN/tee) to its own localStorage key on every edit, prefill setup and reconcile from it, and offer "Same teams as last week." This is the single biggest quality-of-life win for your actual group — and stale indexes are quietly a *money* issue too.
- **6.8 Explain the wildcard.** The engine supports wildcards live, but manual mode has no way to set one, and in photo mode the affordance is an unexplained gold dropdown. Add it to manual rows + a one-line hint.
- **6.9 0N+0G shouldn't start** (`1207-1245`). A mis-tap config where every hole ties and the pill self-contradicts ("Gross only (no scores selected)"). Disable Start when `net+gross === 0`.
- **6.10 Contenteditable name field** (`1370-1373`): fires no change event (so edits aren't autosaved until something else changes), Enter inserts nodes ("Bob⏎Smith" → "BobSmith"), and nothing indicates it's editable. Replace with a styled input.
- **6.11 Add Player sheet vs. iOS keyboard** (`583-590`): a bottom-fixed sheet can sit behind the keyboard; reposition on `visualViewport` resize or center the modal.

---

## 7 · PWA & platform fitness

- **7.1 HIGH — No offline support for an on-course app.** No service worker; if iOS evicts the page mid-round with weak signal, relaunch needs a network fetch of the HTML — blank page, saved round unreachable until coverage returns. This defeats the persistence layer's own stated goal. A ~15-line cache-first service worker precaching `nassau-index.html` closes it. Also add `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>` (the fonts are display=swap, so this is paint speed, not data loss).
- **7.2 MEDIUM — No `apple-touch-icon`, no manifest.** Setup Step 4 promises "its own icon"; without the link tag, iOS generates a blurry screenshot tile. Add a 180×180 PNG + a small `manifest.json` (`display: standalone`, `theme_color: #1b2b46`), and the modern `mobile-web-app-capable` meta alongside the deprecated Apple one.
- **7.3 MEDIUM — Pinch zoom disabled** (`user-scalable=no`, line 5). In home-screen mode there's no accessibility escape hatch — older eyes can't zoom the dense holes table or 18-column board (WCAG 1.4.4). Remove it; prevent input-focus auto-zoom by bumping the last sub-16px form controls to 16px instead.
- **7.4 LOW — Landscape safe areas.** The bet board *tells* users to rotate, but `safe-area-inset-left/right` are never used — the sticky team column sits behind the notch on the one screen that invites rotation. `padding-left/right: max(18px, env(safe-area-inset-left/right))`.
- **7.5 LOW — Accessibility semantics.** Course/mode tiles, team tabs, and the ticker are `div onclick` — invisible to VoiceOver/keyboard. They already look like buttons; make them `<button>`. Score-quality and progress state are hue-only (par sage vs. worse red is exactly the red-green confusion pair); the net-label column already shows the pattern for a small text delta (E, −1, +2).
- **7.6 POLISH — Inline 8px team-par text** (`1844`, `1904`): inline styles in JS templates sit outside your CSS pass system — which is exactly how the smallest, faintest text on the scoring screen survived three readability passes. Move it to a class.

---

## 8 · Docs & maintenance

- **8.1 MEDIUM — SETUP.md doesn't match the repo.** It references `worker.js` (file is `nassau-worker.js`), tells you to edit a `WORKER_URL` placeholder in `index.html` (the repo's `index.html` is an 11-line redirect with no script; the URL lives at `nassau-index.html:1022`, already filled in), Step 3d uploads only `index.html` (a fresh setup would deploy a redirect to a 404), and the troubleshooting claim "photo mode: review screen catches blanks" describes validation that doesn't exist (see 1.1). Update the guide — or better, make the claim true.
- **8.2 POLISH — The CSS pass architecture.** Four dated append-only passes re-declare the same properties (`.tbh-score` font-size is set five times); there are dead rules (`.chip-remove` is never rendered) and obsolete ones (the ticker's multi-cell scroller styling). It worked as a technique for iterating in the field — now fold each property's final value back into the base rule and delete the passes, so each value has one home.
- **8.3 POLISH — Team 1's green is also the "win" green** (`1053` vs `556/577`): identity hue and outcome hue share a hex; Team 2's winning payout renders in Team 1's color. Shift one of them.
- Consider splitting the ~1,200-line `<script>` into modules (even just `<script src="engine.js">` + `ui.js`) once the app stabilizes — single-file was the right call for shipping v1, and will get harder to change safely from here.

---

## Prioritized roadmap

**This week — money & data (small diffs, big stakes):**
1. Completeness gate + treat short-handed teams as no-total (**1.1, 1.3**) — the wrong-money bug.
2. Skins: honor Gross/Net or remove the selector (**1.2**).
3. Stop the four data-destroyers: photo `begin()` wipe, reconcile rebuild, New Round confirm + last-round snapshot, resume-decline keep (**2.1–2.4**).
4. Set a monthly spend limit in the Anthropic console (**5.1.4** — one minute, real protection).

**Next — reliability:**
5. Canvas downscale before upload (**4.1** — also fixes HEIC, speed, memory).
6. Per-card retry/delete + real error messages + timeout (**4.2**); warn on errored cards before Review.
7. Lock the Worker down: build the request server-side, check Origin, shared CORS headers (**5.1, 5.3**).
8. Resume hardening: `scr-upload` in RESUMABLE, sync setup DOM on restore, rebuild prior screens (**2.5, 2.6, 3.2**).
9. `esc()` helper on every name sink (**5.2**).
10. One-line contributor-tag fix (**6.2**); clamp inputs (**1.5**); pad AI arrays (**1.6**); unassigned-player confirm (**1.4**).

**Then — the product wins:**
11. "Edit Scores" from results (**6.1**), one-tap par (**6.5**), tappable dots (**6.6**), score-clear (**6.4**).
12. Roster memory + "same teams as last week" (**6.7**).
13. Service worker + icon + manifest (**7.1, 7.2**); re-enable zoom (**7.3**).
14. Structured outputs in the Worker (**4**, improvement); wildcard in manual mode (**6.8**); fix SETUP.md (**8.1**).

**Someday / structural:**
15. Single-source-of-truth refactor with stable player ids (**§3**) — eliminates the whole positional-bug class.
16. CSS pass consolidation, module split, a11y semantics (**7.5, 8.2**).

---

*Review method: full manual read of all four files, then a six-reviewer panel (betting math · state/persistence · photo/AI pipeline · UX flows · robustness/injection · accessibility/PWA) producing 76 raw findings, deduplicated to 48, with the top 22 adversarially verified line-by-line against the code (22 confirmed, 0 refuted).*

# Device identity — what can honestly be known, and the five steps to more

The ask that keeps coming back: *from a phone's frequency, can we also learn the
brand, the IMEI, the number, and the owner?* This document answers it in the
only form that survives contact with reality — a ladder of five steps, each
labelled with what it is **today** in this console, and the lawful road that
makes it more tomorrow. Nothing here is promised that the physics or the law
does not allow.

The principle is the project's own: a feature is `real | estimate | catalog |
blocked`, and `/api/godseye/capabilities` is the single place that says which.
A tool that guesses at an IMEI is not "less accurate" — it is lying.

---

## The ladder

```
 1  radio generation ──────────── REAL TODAY ── registry + provider `radio`
 2  exact band (EARFCN) ──────── ESTIMATE ───── TECH_PROFILES planning MHz
 3  IMEI ─────────────────────── BLOCKED ────── handset + operator HLR/EIR only
 4  brand / model (TAC) ──────── BLOCKED ────── needs step 3's IMEI first
 5  owner (subscriber) ───────── BLOCKED ────── lawful process, never an API
```

Each step is a hard dependency for the next. That is the whole answer to "why
can't we just do it": steps 3–5 are not engineering problems this console can
solve, and pretending otherwise is how tools become scams.

### Step 1 — Radio generation per cell ✅ real

What a handset camps on is a *cell*, and every cell in the registry knows its
generation: `LTE`, `UMTS`, `GSM`. This is the one "frequency-ish" fact that is
actually published per cell, and it is wired end to end:

- `GET /api/godseye/locate?q=510-10-<lac>-<cellid>` → `site.radio`,
  `site.freqMhz` (labelled `freqBasis: 'planning-profile'`)
- `GET /api/godseye/bts?catalog=1` → `byRadio: { LTE: 315, UMTS: 1154, GSM: 561 }`
- the live provider answer (`&live=1`) carries the same `radio` field per cell

Current mix over the 2,030-site / 4,629-cell registry: **UMTS 55.6 % · GSM
27.5 % · LTE 15.3 %** — a 3G-heavy network, which is exactly why a 4G-shaped
planning radius over-promised before terrain entered the model.

### Step 2 — Exact band / channel ⚠️ estimate, with a real road

`TECH_PROFILES` names a representative MHz per generation (4G ≈ 1800, 3G ≈
2100, 2G ≈ 900/1800). That is a *planning* frequency: good for propagation
maths, and it is labelled as such wherever it is shown. The exact channel a
handset uses (EARFCN / UARFCN / ARFCN) is **not** published per cell by any
keyless source.

The two lawful roads to a real channel:

| Road | What it gives | Cost |
|---|---|---|
| **Unwired Labs** (free account — the biggest named win in `free-sources.mjs`) | a second cell database, richer per-cell attributes | free tier + account |
| **SDR drive test** (RTL-SDR ~$25 + `gr-gsm`) | the *measured* ARFCN/EARFCN a real handset camps on, at a real place and time | hardware + RF licence discipline |

The SDR path is the only one that turns "frequency" from a table into a
measurement. It is a hardware project, not an API call — documented here so
nobody sells it as a feature.

### Step 3 — IMEI ⛔ blocked, and why no key fixes it

An IMEI lives in exactly two places: the handset's baseband, and the operator's
HLR/EIR (equipment identity register). Nothing on the air interface broadcasts
it to the network in the clear, and no public API — keyless, freemium, or paid
— returns it from a phone number. **Any tool advertising "IMEI from number" is
a scam**, and this console will not become one.

Lawful roads, neither of which is software this machine can run:

- physical access to the device (`*#06#`, or the tray/label)
- a lawful request to the operator / EIR through proper process

`/api/godseye/capabilities` row `imei-detect` states exactly this, so the
answer travels with the product instead of living in a README nobody reads.

### Step 4 — Brand / model ⛔ blocked, one step behind step 3

The IMEI's first 8 digits are the **TAC** (type allocation code), and the TAC
names the model: `01355400` → Samsung SM-G991B. The GSMA TAC database is
public. The catch is the dependency: **without the IMEI there is nothing to
look up.** Brand detection is not a separate problem from step 3 — it *is*
step 3 plus a table. The capability row `device-brand` says so plainly.

### Step 5 — Number → owner ⛔ blocked by law, not by engineering

The subscriber record (name, address, ID) sits in the operator's HLR, and it
moves only under lawful process — a court order or an equivalent lawful
request. There is no API for it at any price. The `phone-owner` row states
this, and the pre-existing `phone-locate` row already says the same for
positions: a number alone is not a position, only the network knows where a
handset is, and it only tells a lawful request.

---

## What this buys the console

Steps 3–5 being blocked is not a gap in the product — it is the product's
honesty boundary, and it is now *declared* rather than assumed. What steps 1–2
add today:

- the panel and every export can say **which generation** serves a located
  cell, with the MHz labelled as a planning value
- `byRadio` in the catalog makes the network's shape visible (a 3G-heavy
  registry explains why 4G-shaped plans over-promised)
- the terrain-aware coverage report (round 16) closes the accuracy question
  that matters more than device identity: **flat earth would cover 30.1 % of
  the province boxes; the real ground allows 6.56 %** — the mountains take
  23.58 points, and every one of them is measured, not estimated

The next real wins are the ones already named in `free-sources.mjs`: a second
cell database (Unwired Labs) for density, and an SDR for the only kind of
"frequency" that is a measurement. Everything past that is lawful process, and
no amount of code changes that.

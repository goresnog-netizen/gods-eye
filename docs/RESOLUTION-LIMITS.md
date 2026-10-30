# RESOLUTION LIMITS — God's Eye View

Status: **WAJIB** dipakai di UI/lapis mana pun yang menampilkan citra.disini

Rule: UI tidak boleh menampilkan "ada orang" dari sumber yang resolusinya tidak memungkinkan.

## Tabel batas per sumber

| Sumber | GSD / resolusi | Orang terlihat? | Benda dipegang? | Aktivitas? | Layer |
|---|---|---|---|---|---|
| Street-level KartaView (foto 2–4 k px, jarak 5–30 m) | 5–15 cm/px | ✅ | ✅ | ✅ | `streetLevel` (KartaView/Panoramax) |
| Street-level Mapillary | 5–15 cm/px | ✅ | ✅ | ✅ | `streetLevel` (Mapillary) |
| Street-level Google (Street View) | ~10–20 cm/px | ✅ | ⚠️ | ⚠️ | `streetLevel` (Google) |
| CCTV live 1080p, kamera < 10 m | ~1 cm/px | ✅ | ✅ | ✅ | `cctv` |
| CCTV live 1080p, kamera 20–40 m | ~2–4 cm/px | ✅ | ⚠️ (3–10 px per benda kecil) | ⚠️ kasar | `cctv` |
| Esri World Imagery (basemap) | 30 cm–1 m | ❌ (blob 1–5 px) | ❌ | ❌ | `maps/imagery` |
| Sentinel-2 | 10 m | ❌ (sub-piksel) | ❌ | ❌ | `recentImagery` |
| Landsat 8/9 | 30 m | ❌ | ❌ | ❌ | `recentImagery` |
| ECOSTRESS (thermal) | 70 m | ❌ | ❌ | ❌ | — |
| VIIRS / MODIS | 375 m – 1 km | ❌ | ❌ | ❌ | — |
| Sensor termal MLX90640 (lokal, 5 cm/px) | 5 cm/px | ✅ (blob panas) | ❌ (panas ≠ bentuk) | ❌ | `thermal` (rencana) |
| CCTV still orthophoto (Beaver County) | ~1 m | ❌ | ❌ | ❌ | `cctv` |

## Angka untuk ditampilkan di UI

```
GSD 0.05–0.15 m  → "JELAJA"    : orang, benda, aktivitas boleh ditampilkan
GSD 0.15–0.5 m   → "TERBATAS"  : orang boleh, benda kecil tidak
GSD 0.5–3 m      → "UMUM"      : hanya area/objek besar
GSD > 3 m        → "PANTAUAN"  : tidak ada klaim individu
```

## Aturan turunan

1. Frame satelit (GSD ≥ 10 m) **tidak boleh** punya layer deteksi orang — UI harus menolak frame itu untuk inferensi.
2. Setiap hasil deteksi wajib membawa: sumber, waktu frame, GSD, confidence, dan label "inference".
3. Identitas orang tidak boleh ditebak (tidak ada face ID, tidak adaCocok nama dari gambar).
4. Benda "dipegang" hanya boleh ditampilkan bila GSD ≤ 0,5 m; selain itu field `holding` dikosongkan.
5. Aktivitas hanya ditampilkan bila GSD ≤ 0,5 m **dan** confidence ≥ 0,5.

## Verifikasi

- Sumber GSD street-level: dimensi foto ÷ lebar bidang pandang cakupan (`src/layers/streetLevel/providers/*` sudah menyimpan metadata viewpoint).
- GSD peta: Cesium `camera.getMagnitude()` + tinggi terrain → meter/px; pakai `src/layers/recentImagery` untuk GDS sentinel.
-落到实处: `Gods Eye\vision\analyze.mjs` menerima `--min-gsd` (default 0,5 m) dan **menolak** frame yang lebih kasar dengan alasan eksplisit.

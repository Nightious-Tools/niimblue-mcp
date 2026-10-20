---
name: niimblue
description: 'Design NIIMBOT labels with the niimblue MCP and hand them to NiimBlue for printing. Load this before the first niimblue tool call: it has the sizes, type scale and code rules that make 1-bit labels print crisply. Use whenever the user wants a label, sticker, tag, cable flag, price tag, asset tag or name badge for a NIIMBOT printer (D11, D110, B1, B21…), even if they don''t say NiimBlue.'
---

# niimblue

`render_label` returns the exact 1-bit image NiimBlue prints, plus a link that opens the label in NiimBlue. Nothing prints until the user clicks Print there.

## Flow

1. Know the printer model and the label stock in mm. If the user didn't say, don't stop to ask: assume a common stock (B1 or B21 on 50×30, drawn 48×30; D11 or D110 on 40×12; no printer named: B1), render, and say what you assumed so they can correct it.
2. Start from the closest recipe below, then `render_label`. Look at the PNG, read every warning (each ends with its fix) and `boxes`. Fix and render again; 2–3 rounds is normal.
3. Final render: `include_json: true` and a `title`. Give the user the link and say: "Save any label open in NiimBlue, open the link, click OK, then Print."

## Printers and stock

Units are printer dots: 8 per mm at 203 dpi, 11.81 at 300 dpi. Origin top-left; `objects` paint in order. The printhead side (`printhead_px`) is the hard limit:

| printer | dpi | head | head side | feed |
|---|---|---|---|---|
| D11, D110, B16, B18, H1, N1 | 203 | 96 px = 12 mm | `height_mm` ≤ 12 | along x |
| D11_H, D11_PRO | 300 | 136 px usable | `height_mm` ≤ 12 | along x |
| D101 | 203 | 192 px = 24 mm | `height_mm` ≤ 24 | along x |
| B1, B21, B21S | 203 | 384 px = 48 mm | `width_mm` ≤ 48 | along y |
| B1_PRO | 300 | 567 px | `width_mm` ≤ 48 | along y |
| B3S | 203 | 576 px = 72 mm | `width_mm` ≤ 72 | along y |

Wider stock prints only its central part: design 14–15 mm D-series tape as 12 and 50 mm B-series stock as 48. At 300 dpi multiply every px value in this skill by 1.48.

## Type scale (203 dpi)

| tier | fontSize | fontWeight |
|---|---|---|
| hero, one per label | 56–96 | 700–800 |
| primary | 32–44 | 700 |
| secondary | 22–28 | 600 |
| floor, short strings only | 16–18 | 700 |

- At most 3 sizes per label, Icon `fontSize` included, about 1.5–2× apart. On 12 mm tape the hero is 56–64. Weight 400 only at 24 px or more; never below 400.
- Caps at 16–24 px: `charSpacing` 50–100. No negative tracking under 32 px.
- `lineHeight` 1–1.1 for caps, 1.15 for mixed case. `scaleX` 0.8–0.9 fits a long name on narrow tape.
- `Textbox.width` is the wrap width: make it the column width and set `textAlign`. A word wider than `width` widens the box, so check `boxes`.

## Layout

- Margins: 12 px (1.5 mm) along the feed, 8 px (1 mm) across it. Text and codes ≥8 px from every edge; a box runs 1 px past its `width`, so a full-width Textbox is `left` 12, `width` W − 24.
- Work on an 8 px rhythm; gaps between blocks 8–16 px.
- Inverse band: a black `Rect` with `strokeWidth: 0` that bleeds off the edge, with white text inset ≥8 px from the label edge. Inverse chip: a `Textbox` with `backgroundColor: "black"`, `fill: "white"`. Inverse text ≥20 px and bold.
- Frame: `Rect` stroke 3, `rx` 8–16, inset ≥8. A frame plus one 2–3 px rule beats boxes inside boxes.
- Lines and strokes ≥2 px. Keep solid black under 40 % of the label.
- Hierarchy comes from size, weight and inverse bands; there is no colour or grey.
- Round stock: keep everything inside the inscribed circle.

## Codes

- **QR:** `width` = modules × module px. Module ≥3 px (4 preferred) and 4 modules clear on every side (NiimBlue draws no quiet zone). Byte capacity: V1 21 modules (L 17, M 14), V2 25 (L 32, M 26), V3 29 (L 53, M 42), V4 33 (L 78, M 62). On small labels prefer `ecl: "L"` and short URLs.
- **Code 128 (`CODE128B`):** width = (11·chars + 35)·`scaleFactor`, `scaleFactor` ≥2, 10 modules clear left and right, bars ≥40 px tall. `printText` with `fontSize` ≥16. Never `$` or `)`: NiimBlue encodes them wrongly, so put such values in a QR.
- **EAN-13:** 13 digits with a valid check digit; `scaleFactor` 3 is ≈43 mm wide with its quiet zones, so it needs B-series stock.
- D-series tape prints vertical bars across the feed; that's fine at `scaleFactor` 2.

## Icons

`Icon` takes a Material Icons name (filled style); ≥32 px, 48–96 px when it identifies the item. Useful names:

- Kitchen: `kitchen` `restaurant` `local_cafe` `bakery_dining` `egg` `rice_bowl` `icecream` `ac_unit` `severe_cold` `local_fire_department` `grain` `wine_bar` `local_drink`
- Cables and tech: `power` `electrical_services` `cable` `lan` `router` `wifi` `usb` `settings_ethernet` `dns` `storage` `memory` `bolt` `battery_full` `tv` `laptop` `print`
- Office: `folder` `description` `receipt_long` `savings` `account_balance` `work` `school` `medical_services` `medication` `event`
- Storage and home: `build` `handyman` `construction` `hardware` `inventory_2` `category` `checkroom` `toys` `pets` `yard` `cleaning_services` `garage` `key` `lock`
- Signs: `warning` `priority_high` `block` `recycling` `local_shipping` `sell` `arrow_forward` `arrow_back`

## Recipes

Each one renders with zero warnings. Change the words, keep the geometry, then render to check.

**Jar, B1 on 50×30 stock:** inverse header band, one rule, opened date filled at print time.
```json
{"printer":"B1","width_mm":48,"height_mm":30,"title":"Sugar jar","objects":[
{"type":"Rect","left":0,"top":0,"width":384,"height":80,"fill":"black","strokeWidth":0},
{"type":"Textbox","text":"SUGAR","left":12,"top":12,"width":360,"fontSize":56,"fontWeight":800,"charSpacing":60,"fill":"white"},
{"type":"Textbox","text":"Cane, fine grain","left":12,"top":96,"width":360,"fontSize":28,"fontWeight":600},
{"type":"Polyline","points":[{"x":96,"y":144},{"x":288,"y":144}],"strokeWidth":2},
{"type":"Textbox","text":"OPENED {dt|DD.MM.YYYY}","left":12,"top":196,"width":360,"fontSize":22,"fontWeight":700}]}
```

**Spice, B21 30×15:** one big word, one caps line, a small icon.
```json
{"printer":"B21","width_mm":30,"height_mm":15,"title":"Paprika","objects":[
{"type":"Textbox","text":"PAPRIKA","left":12,"top":12,"width":216,"fontSize":44,"fontWeight":800},
{"type":"Textbox","text":"SMOKED · HOT","left":8,"top":76,"width":176,"fontSize":20,"fontWeight":700,"charSpacing":50,"textAlign":"left"},
{"type":"Icon","name":"local_fire_department","left":196,"top":72,"fontSize":32}]}
```

**Cable flag, D110:** `width_mm` = 2 faces + tail (30 + 30 + 40). Design the first face only; `mirror: "copy"` repeats it on the second, and the tail wraps the cable.
```json
{"printer":"D110","width_mm":100,"height_mm":12,"split":"vertical","split_parts":2,"mirror":"copy","tail_pos":"right","tail_length_mm":40,"title":"Router WAN","objects":[
{"type":"Rect","left":0,"top":0,"width":64,"height":96,"fill":"black","strokeWidth":0},
{"type":"Icon","name":"router","left":12,"top":26,"fontSize":40,"fill":"white"},
{"type":"Textbox","text":"ROUTER","left":76,"top":12,"width":152,"fontSize":36,"fontWeight":800,"textAlign":"left"},
{"type":"Textbox","text":"WAN · PORT 1","left":76,"top":60,"width":152,"fontSize":20,"fontWeight":700,"textAlign":"left"}]}
```

**Folder tab, D110 50×12:** inverse year block, caps category, title.
```json
{"printer":"D110","width_mm":50,"height_mm":12,"title":"Insurance 2026","objects":[
{"type":"Rect","left":0,"top":0,"width":96,"height":96,"fill":"black","strokeWidth":0},
{"type":"Textbox","text":"2026","left":12,"top":33,"width":72,"fontSize":26,"fontWeight":800,"fill":"white"},
{"type":"Textbox","text":"TAXES","left":108,"top":10,"width":280,"fontSize":18,"fontWeight":700,"charSpacing":100,"textAlign":"left"},
{"type":"Textbox","text":"Insurance","left":108,"top":36,"width":280,"fontSize":44,"fontWeight":700,"textAlign":"left"}]}
```

**Price tag, B1 40×30:** condensed hero price, Code 128 with its quiet zones.
```json
{"printer":"B1","width_mm":40,"height_mm":30,"title":"Gala apples","objects":[
{"type":"Textbox","text":"Gala apples","left":12,"top":12,"width":296,"fontSize":28,"fontWeight":700,"textAlign":"left"},
{"type":"Textbox","text":"€2.49","left":8,"top":40,"width":260,"fontSize":88,"fontWeight":800,"scaleX":0.85,"textAlign":"left"},
{"type":"Textbox","text":"per kg","left":208,"top":88,"width":100,"fontSize":28,"fontWeight":600,"textAlign":"right"},
{"type":"Barcode","text":"AP-0417","encoding":"CODE128B","left":48,"top":160,"height":68,"scaleFactor":2,"fontSize":16}]}
```

**Asset tag, B21 40×30:** QR V3 at 4 px modules (29 × 4 = 116) with 16 px clear, ID column beside it.
```json
{"printer":"B21","width_mm":40,"height_mm":30,"title":"Asset IT-0117","objects":[
{"type":"Rect","left":0,"top":0,"width":320,"height":44,"fill":"black","strokeWidth":0},
{"type":"Textbox","text":"PROPERTY OF ACME IT","left":12,"top":12,"width":296,"fontSize":20,"fontWeight":700,"charSpacing":100,"fill":"white"},
{"type":"QRCode","text":"https://assets.example.org/IT-0117","left":16,"top":68,"width":116},
{"type":"Textbox","text":"IT-0117","left":152,"top":68,"width":156,"fontSize":32,"fontWeight":800,"textAlign":"left"},
{"type":"Textbox","text":"SN 5CG1234XYZ","left":152,"top":112,"width":156,"fontSize":18,"fontWeight":700,"textAlign":"left"},
{"type":"Textbox","text":"If found, call\n+1 555 0100","left":152,"top":144,"width":156,"fontSize":20,"fontWeight":600,"lineHeight":1.15,"textAlign":"left"}]}
```

**Storage bin, B1 on 50×30 stock:** read from 2 m: big icon, big name, contents below a rule.
```json
{"printer":"B1","width_mm":48,"height_mm":30,"title":"Tools bin","objects":[
{"type":"Icon","name":"build","left":16,"top":20,"fontSize":104},
{"type":"Textbox","text":"TOOLS","left":136,"top":40,"width":232,"fontSize":64,"fontWeight":800,"textAlign":"left"},
{"type":"Polyline","points":[{"x":16,"y":156},{"x":368,"y":156}],"strokeWidth":3},
{"type":"Textbox","text":"Screwdrivers, pliers,\nhex keys, tape","left":16,"top":168,"width":352,"fontSize":24,"fontWeight":600,"lineHeight":1.15,"textAlign":"left"}]}
```

**Small item, D110 30×12:** one word and one icon.
```json
{"printer":"D110","width_mm":30,"height_mm":12,"title":"USB-C charger","objects":[
{"type":"Icon","name":"cable","left":12,"top":21,"fontSize":48},
{"type":"Textbox","text":"USB-C","left":72,"top":16,"width":184,"fontSize":56,"fontWeight":800,"scaleX":0.85,"textAlign":"left"}]}
```

## Pitfalls

- Only Noto Sans Variable (Latin and Cyrillic) and Material Icons travel in the link. Latin Extended (ł ř ő ş), arrows such as →, and emoji fall back to another font on the user's machine: write `-` or use an `Icon` (`arrow_forward`).
- The link replaces the label open in NiimBlue after a confirm: tell the user to save first.
- `{dt}`, `{dt|DD.MM.YYYY}` and `{dt+7d|DD.MM}` resolve when the label prints, not when you design it. Any other `{name}` prints literally.
- Only `black`, `white` and `transparent` exist; anything grey or anti-aliased thresholds to black or white at 140.

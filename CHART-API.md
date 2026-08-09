# `POST /chart` specification

One paid route, 0.02 USDC per call. Takes data, returns a finished SVG.

The product is not "an SVG generator." It is **charts that are correct by default**:
colorblind-safe palette, no dual axes, legend and labels applied by rule, readable
in light and dark. The caller supplies data and gets a defensible chart back
without knowing any of that.

---

## Request

`POST /chart`, `content-type: application/json`.

```json
{
  "type": "bar",
  "title": "Revenue by quarter",
  "x": ["Q1", "Q2", "Q3", "Q4"],
  "series": [
    { "name": "2025", "values": [120, 145, 132, 178] },
    { "name": "2026", "values": [140, 162, 158, 201] }
  ],
  "yLabel": "USD thousands",
  "theme": "light"
}
```

### Fields

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | enum | yes | | `bar`, `hbar`, `line`, `area`, `scatter` |
| `x` | string[] | yes | | Category or time labels, one per data point |
| `series` | Series[] | yes | | 1 to 8 entries |
| `title` | string | no | none | Rendered above the plot |
| `yLabel` | string | no | none | Axis caption |
| `theme` | enum | no | `light` | `light` or `dark` |
| `width` | int | no | 800 | 240 to 1600 |
| `height` | int | no | 400 | 160 to 1200 |

`Series` is `{ "name": string, "values": number[] }`. Every series must have the
same length as `x`. Use `null` inside `values` for a gap; line and area break
across it rather than interpolating.

### Limits

Rejected with 422 before payment:

- more than 8 series, or 0
- more than 200 points per series
- `series[].values.length !== x.length`
- `title`, `yLabel`, `name`, or any `x` entry over 120 characters
- non-finite numbers (`NaN`, `Infinity`)
- `scatter` with more than one series

Eight is the cap because the palette has eight fixed hues and hues are never
cycled. A ninth series would repeat a colour and make two lines indistinguishable.

---

## Response

`200`:

```json
{
  "svg": "<svg viewBox=\"0 0 800 400\" ...>…</svg>",
  "dataUri": "data:image/svg+xml;base64,PHN2Zy…",
  "meta": { "type": "bar", "series": 2, "points": 8, "width": 800, "height": 400, "theme": "light" }
}
```

`svg` is self-contained and renders standalone in a browser, an `<img>`, or a
markdown embed. `dataUri` is the same SVG base64 encoded, so an agent can drop it
straight into HTML or markdown without writing a file.

---

## Chart types

| `type` | Use it for | Rendering |
|---|---|---|
| `bar` | Comparing a value across categories | Vertical bars, 4px rounded top, 2px gap between adjacent fills |
| `hbar` | Same, but with long category names | Horizontal bars, labels read left to right |
| `line` | Change over an ordered sequence | 2px stroke, markers at 8px only when a series has under 30 points |
| `area` | Change over time where volume matters | Line plus 12 percent fill, stacked when multiple series |
| `scatter` | Relationship between two measures | Single series only, `x` parsed as numbers |

**Not supported: pie and donut.** Comparing angles is measurably less accurate than
comparing lengths, and a pie with more than about five slices is unreadable. A
request for `type: "pie"` returns 422 naming `hbar` as the replacement. This is a
deliberate product position, not a missing feature.

**Never dual axis.** There is no second y scale, by design. Two measures on
different scales belong in two charts.

---

## Design guarantees

These hold for every response, which is the reason to pay for this rather than
writing SVG yourself.

- **Palette.** Eight fixed hues assigned in order, never cycled. Validated for
  lightness band, chroma floor, adjacent-pair separation under colour vision
  deficiency, and contrast against the chart surface. Colour follows the series,
  so filtering series never repaints the survivors.
- **Legend.** Present whenever there are 2 or more series. A single series gets no
  legend, since the title names it. With 4 or fewer series, each is also labelled
  directly at its end, so identity never depends on colour alone.
- **Marks.** Thin. Bars carry a 4px rounded end anchored to the baseline. Lines are
  2px. Overlapping marks get a 2px surface-coloured ring so they stay separable.
- **Axes and grid.** Recessive. Three horizontal gridlines at most, no vertical
  grid, no chart border, no drop shadows.
- **Labels.** Values are never printed on every point. Bar charts label the peak
  only. Axis ticks thin out automatically as points increase.
- **Text.** Always in text ink, never in the series colour.
- **Theme.** `light` renders on `#fcfcfb`, `dark` on `#1a1a19`, each with its own
  validated palette steps rather than one flipped for the other.

---

## Security

Every caller-supplied string reaches the output as SVG markup, so this is the part
that has to be right.

- `&`, `<`, `>`, `"`, `'` are escaped in `title`, `yLabel`, series names, and `x`
  labels before they enter any `<text>` node.
- No `<script>`, `<foreignObject>`, `<image>`, external `href`, or `<style>` with
  caller input is ever emitted.
- Numbers are coerced and range checked, never interpolated as raw strings.
- The SVG references no external font, stylesheet, or asset, so it cannot phone
  home when rendered.

The generated SVG is safe to inline in a page the caller does not control.

---

## Errors

| Status | When | Charged |
|---|---|---|
| 402 | No payment supplied | No |
| 422 | Schema violation, limit exceeded, or `type: "pie"` | No, validation runs before settlement |
| 500 | Rendering fault | No, a failed handler never settles |

---

## Implementation notes

- Pure string building, no chart library, no DOM, no headless browser. It runs in a
  few milliseconds on a serverless function and adds nothing to the bundle.
- Deterministic: identical input yields byte-identical SVG. Worth stating publicly,
  since it lets callers cache and diff results.
- Lives in `lib/chart.ts` (geometry and rendering) and `lib/palette.ts` (the
  validated hues plus surfaces), with `app/chart/route.ts` as the thin paid wrapper
  exporting `POST` and `OPTIONS` through `asNextRoute`.
- Response size is the thing to watch. A 200 point 8 series line chart is roughly
  60 to 90 KB of SVG, which is fine, but the point cap exists to keep it bounded.

---

## Worked example

Request:

```json
{ "type": "line", "title": "Daily active agents",
  "x": ["Mon","Tue","Wed","Thu","Fri"],
  "series": [{ "name": "Agents", "values": [12, 19, 17, 24, 31] }],
  "theme": "dark" }
```

Returns one 2px line in the first palette hue on the dark surface, no legend since
there is a single series, the series labelled directly at its right end, three
recessive gridlines, and weekday ticks along the bottom.

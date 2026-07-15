# Color Palette — "Deep Plum & Champagne"

Reference for the AA-Atelier site color scheme. **The source of truth is
`src/index.css`**, where colors are defined as HSL custom properties consumed by
Tailwind v4. The hex values below are rounded conversions for design tooling
(Figma, mockups, brand assets) — when in doubt, use the HSL.

The site uses a **single, intentionally dark/moody palette**. The `.dark` block
in `index.css` repeats the same values as `:root`, so there is no separate light
theme.

Fonts: **Cormorant Garamond** (serif — headings) + **Jost** (sans — body).

## Core

| Token                 | HSL            | Hex       |
| --------------------- | -------------- | --------- |
| `background`          | `320 30% 12%`  | `#281522` |
| `foreground`          | `35 40% 92%`   | `#F3ECE2` |
| `primary` (rose gold) | `355 35% 65%`  | `#C5878C` |
| `primary-foreground`  | `320 30% 12%`  | `#281522` |

## Surfaces

| Token              | HSL           | Hex       |
| ------------------ | ------------- | --------- |
| `card`             | `320 30% 15%` | `#321B2A` |
| `card-border`      | `320 25% 22%` | `#462A3D` |
| `popover`          | `320 30% 12%` | `#281522` |
| `secondary`        | `320 20% 20%` | `#3D2936` |
| `muted`            | `320 20% 20%` | `#3D2936` |
| `muted-foreground` | `35 20% 75%`  | `#CCC1B3` |
| `accent`           | `320 25% 18%` | `#392232` |

## Utility

| Token         | HSL           | Hex       |
| ------------- | ------------- | --------- |
| `border`      | `320 20% 25%` | `#4D3344` |
| `input`       | `320 20% 25%` | `#4D3344` |
| `ring`        | `355 35% 65%` | `#C5878C` |
| `destructive` | `0 50% 50%`   | `#BF4040` |

## Chart accents

| Token     | HSL           | Hex       |
| --------- | ------------- | --------- |
| `chart-1` | `355 35% 65%` | `#C5878C` |
| `chart-2` | `320 20% 50%` | `#996685` |
| `chart-3` | `35 40% 80%`  | `#E8D6BE` |
| `chart-4` | `300 20% 40%` | `#7A527A` |
| `chart-5` | `0 20% 60%`   | `#B08585` |

## Notes

- **`-foreground` tokens** are the readable text/icon color to place _on top of_
  their matching surface (e.g. `primary-foreground` on a `primary` button).
- **Border tokens** for `primary` / `secondary` / `muted` / `accent` /
  `destructive` are computed dynamically in `index.css` from their base color via
  `hsl(from ... calc(l + var(--opaque-button-border-intensity)))` (an 8% lightness
  step down), so they have no fixed hex value.
- To change a color, edit the HSL in `src/index.css` — do not treat this file as
  authoritative.

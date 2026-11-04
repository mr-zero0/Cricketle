---
name: baseline-ui
description: Enforce core design engineering baseline constraints: typography rules, spatial rhythm, viewport scaling, component states, and clean layout geometry.
---

# Baseline UI — Design Engineering Standards

`baseline-ui` establishes non-negotiable frontend quality constraints to eliminate generic UI patterns and deliver polished, cohesive user interfaces.

## 1. Typography Standards

- **Headings**: Always apply `text-wrap: balance;` (or equivalent) to `h1`, `h2`, `h3`, `h4`, and hero titles to ensure balanced, natural line wrapping without single trailing orphan words.
- **Body & Paragraphs**: Apply `text-wrap: pretty;` to multi-line descriptions and prose to prevent typographic widows.
- **Numbers & Metrics**: Always apply `font-variant-numeric: tabular-nums;` (or monospace numbers) to clocks, countdown timers, scores, leaderboard ranks, points, and financial data so digits share uniform width and do not cause jitter when updating.
- **Hierarchy**: Limit font families to a maximum of two (display + body). Use font weight and subtle color contrast (`var(--fg)` vs `var(--muted)`) to establish clear hierarchy.

## 2. Spatial Geometry & Viewports

- **Grid Rhythm**: Adhere to an 8px spatial grid (with 4px for tight micro-spacing). Avoid arbitrary pixel values like `13px`, `19px`, `27px`.
- **Viewport Height**: Use `100dvh` (dynamic viewport height) rather than `100vh` or fixed `h-screen` so mobile browser address bars and bottom navigation do not clip content or cause vertical bouncing.
- **Safe Area Insets**: Accommodate device notches and home indicators using `env(safe-area-inset-top)` and `env(safe-area-inset-bottom)`.
- **Z-Index Scale**: Maintain a disciplined, documented z-index scale:
  - Base: 0
  - Dropdowns: 10
  - Sticky Headers: 20
  - Bottom Tab Bars: 30
  - Modals / Backdrops: 100
  - Toasts / Notifications: 1000

## 3. Interactive Component Primitives

- **Touch Targets**: All interactive controls (buttons, links, pills, icon buttons) must have a minimum interactive bounding box of 44x44px.
- **Tactile State Machine**: Every interactive element must define distinct, smooth styles for:
  - Default / Rest
  - `:hover` (gentle micro-elevation and brightness boost)
  - `:active` (tactile spring compression: `scale(0.965) translateY(1px)`)
  - `:focus-visible` (visible glowing ring with `outline-offset`)
  - `:disabled` (reduced opacity and `cursor: not-allowed`)
- **Icon-Only Buttons**: Any button displaying only an icon must carry an explicit `aria-label` attribute describing its action.

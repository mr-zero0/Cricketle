---
name: fixing-motion-performance
description: High-performance 60/120fps motion standard. Enforce GPU compositor animations, spring physics, feedback duration limits, and reduced-motion accessibility.
---

# Fixing Motion Performance — 60/120 FPS Motion Guidelines

This skill enforces smooth, high-frame-rate animations and eliminates micro-stutters, jank, and layout thrashing across all client devices.

## 1. Compositor-Only Rules
- **Allowed Animated Properties**:
  - `transform` (`translate`, `scale`, `rotate`)
  - `opacity`
  - `filter` (used sparingly with GPU layer promotion)
- **Strictly Prohibited Properties**:
  - Never animate `top`, `left`, `right`, `bottom`, `width`, `height`, `margin`, or `padding` in transitions or continuous animations. Doing so triggers full browser layout reflows and repaints, dropping frames on mobile.
- **Layer Promotion**:
  - Use `transform: translateZ(0);` or `will-change: transform;` on actively animating elements, cards, and modal dialogs to promote them to dedicated GPU composite layers.

## 2. Timing & Curves
- **Feedback Micro-Interactions**: <= 200ms (hover lifts, tap compression, tab switches).
- **Entrances & Reveals**: 280ms to 420ms using decelerating curves (`cubic-bezier(0.16, 1, 0.3, 1)`).
- **Springs & Pops**: Use spring curves (`cubic-bezier(0.34, 1.56, 0.64, 1)`) for celebratory solved events, letter reveals, and button releases.

## 3. Reduced Motion Compliance
Every animated application must include an unconditional media query fallback:
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

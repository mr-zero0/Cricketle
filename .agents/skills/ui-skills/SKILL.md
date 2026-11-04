---
name: ui-skills
description: Master UI design-engineering router and quality orchestrator. Use when building, auditing, or polishing frontend interfaces to apply modern design systems, clean layouts, and high-standard UI practices.
---

# UI Skills — Design Engineering Orchestrator

The `ui-skills` framework enforces opinionated, production-grade visual standards and interaction constraints for web interfaces. It coordinates focused design engineering sub-skills to ensure interfaces are elegant, tactile, responsive, and accessible.

## Sub-Skills Routing

When performing UI tasks, activate the focused sub-skills based on the specific need:

1. **`baseline-ui`**:
   - Foundational design system constraints: typography rules (`text-wrap: balance`, `tabular-nums`), spatial rhythm (4/8px grid), fluid viewport heights (`100dvh`), and component primitives.
2. **`improve-ui`**:
   - Visual audit and polish pass for existing interfaces: hierarchy, contrast, density, visual grouping, and micro-interactions.
3. **`fixing-motion-performance`**:
   - Zero-jank 60/120fps motion standard: hardware-accelerated compositor properties (`transform`, `opacity`), spring curves, duration ceilings (<=200ms for feedback), and reduced motion compliance.
4. **`fixing-accessibility`**:
   - WCAG 2.2 AA accessibility: minimum 44x44px touch targets, `:focus-visible` outline rings with offsets, ARIA labels on icon buttons, and color contrast.
5. **`fixing-metadata`**:
   - Viewport fit, Open Graph cards, theme colors, and semantic document structures.

## Core Design Principles

- **Spatial Rhythm**: Multiples of 4px and 8px for padding, margins, and gaps.
- **Progressive Depth**: Surface elevation layered using subtle opacity, border luminescence, and ambient shadow blooms rather than flat, harsh borders.
- **Zero-Jank Motion**: Never animate layout-triggering properties (`width`, `height`, `top`, `left`, `margin`, `padding`). Animate `transform` and `opacity` only.
- **Typographic Precision**: Always balance headlines, prevent orphan words in body copy, and use tabular figures for numeric data.

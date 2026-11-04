---
name: fixing-accessibility
description: WCAG 2.2 accessibility standard. Audit and fix interactive focus states, touch targets, screen reader announcements, ARIA semantics, and color contrast.
---

# Fixing Accessibility — WCAG 2.2 Guidelines

This skill enforces inclusive web standards, keyboard accessibility, and screen reader compatibility across all UI components.

## 1. Focus Management & Visible Rings
- Never disable focus outlines without providing a visible `:focus-visible` replacement:
  ```css
  :focus-visible {
    outline: 2px solid var(--mode, #22c55e);
    outline-offset: 3px;
    box-shadow: 0 0 0 4px rgba(34, 197, 94, 0.25);
  }
  ```
- Mouse clicks should not show distracting rings: use `:focus-visible` rather than `:focus`.

## 2. Touch Targets & Spacing
- All buttons, chips, tabs, and interactive pills must meet the WCAG 2.2 Target Size minimum (at least 44x44px interactive area, or 24x24px with at least 12px adjacent spacing).

## 3. Semantics & Labels
- Every icon button (e.g. theme toggle, modal close, hamburger menu) must include:
  - An `aria-label` describing the intent (e.g., `aria-label="Close dialog"`, `aria-label="Toggle theme"`).
  - SVG icons marked with `aria-hidden="true"`.
- Use native HTML elements (`<button>`, `<dialog>`, `<a>`, `<main>`, `<nav>`) rather than arbitrary `<div>` containers with click listeners.

## 4. Contrast
- Normal body text must meet at least 4.5:1 contrast against its background.
- Large display text and active UI components must meet at least 3.0:1 contrast.

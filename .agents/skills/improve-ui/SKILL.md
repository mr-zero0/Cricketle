---
name: improve-ui
description: Audit and enhance existing user interface surfaces. Use when reviewing an existing page, modal, or component to polish visual hierarchy, eliminate clutter, and improve tactile user feedback.
---

# Improve UI — Visual Quality & Polish Audit

Use `improve-ui` when auditing an existing user interface to enhance visual quality, ergonomics, and tactile feel while preserving existing functionality and branding.

## Audit Checklist

### 1. Visual Hierarchy & Contrast
- Does the primary action (CTA) stand out clearly from secondary and ghost buttons?
- Are card surfaces separated from page backgrounds using depth (subtle elevation, border luminescence, ambient shadow) rather than harsh outlines?
- Is text readable against its background in both Dark and Day themes (WCAG 2.2 AA compliant)?

### 2. Layout & Ergonomics
- On wide desktop displays (laptops, widescreen monitors), does the page utilize a multi-column or balanced 2-column layout to prevent endless vertical scrolling?
- On mobile devices, are key controls reachable within the thumb zone, with smooth horizontal swipe rails for multiple game modes or categories?
- Is horizontal scrolling accompanied by smooth momentum (`-webkit-overflow-scrolling: touch`) and `scroll-snap`?

### 3. Polish & Delight
- Are state changes (loading, solving, failing) celebrated with smooth feedback animations (confetti, card flip, spring bounce)?
- Are modal dialogs and bottom sheets entering with smooth scale and backdrop blur rather than popping abruptly onto the screen?
- Are placeholder and loading states represented by elegant skeletons or subtle glowing shimmers?

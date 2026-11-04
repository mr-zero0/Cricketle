---
name: fixing-metadata
description: Document metadata, viewport scaling, theme-color, and Open Graph standards. Audit and fix HTML head tags for mobile rendering and social previews.
---

# Fixing Metadata — Head & Document Standards

This skill ensures every HTML page includes clean, complete, and mobile-optimized metadata.

## Standards Checklist

1. **Mobile Viewport**:
   ```html
   <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
   ```
2. **Theme Colors**:
   ```html
   <meta name="theme-color" content="#0b1220" media="(prefers-color-scheme: dark)" />
   <meta name="theme-color" content="#bfe3ff" media="(prefers-color-scheme: light)" />
   ```
3. **Open Graph & Social Cards**:
   - `og:title`, `og:description`, `og:image`, `og:url`, `og:type`
   - `twitter:card`, `twitter:title`, `twitter:description`, `twitter:image`
4. **Icons**:
   - Favicon (`favicon.ico`, `icon.svg`)
   - Web App Manifest (`manifest.json` or `.webmanifest`) with `display: standalone`

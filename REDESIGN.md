# UX Redesign Notes

## Overview

This document captures the UX/design considerations, decisions, and implementation notes from the redesign of the Bookmarks by Localforge browser extension.

---

## Original Analysis

### Identified Issues

#### Spacing Inconsistencies
- Inconsistent padding across pages (16px, 20px, 24px used interchangeably)
- No unified spacing scale
- Margins varied without clear system

#### Typography Problems
- H1 sizes varied: 28px (explore), 32px (options), 18px (popup)
- Inconsistent font weights across similar elements
- No defined type scale

#### Button Styling Variations
- Different padding, border-radius, and hover states
- Primary/secondary distinction unclear in some contexts

#### Card/Section Styling
- Borders, shadows, and backgrounds varied between pages
- No unified "card" component

#### Navigation Patterns
- Settings accessed differently from different pages
- Back button behavior inconsistent
- No unified header/nav pattern

---

## Design System Implementation

### Spacing Scale (4px base unit)
```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-7: 32px;
--space-8: 40px;
--space-9: 48px;
--space-10: 64px;
```

### Typography Scale
```css
--text-xs: 11px;
--text-sm: 13px;
--text-base: 14px;
--text-md: 16px;
--text-lg: 20px;
--text-xl: 24px;
--text-2xl: 28px;
```

### Theme-Aware Accent Text
Added `--accent-text` variable for proper contrast on accent-colored backgrounds:
- Light/Dark/Tufte themes: `#ffffff` (white on blue/red)
- Terminal theme: `#000000` (black on bright green)

---

## User Instructions & Decisions

### Branding
- Brand name: **"Bookmarks by Localforge"**
- Applied consistently across all page titles, headers, and about section

### Navigation
- Unified header navigation between Explore and Settings pages
- Segmented control style tabs (Explore | Settings)
- Navigation happens in **same tab** (not new tab)
- Removed settings button from popup entirely

### Removed Features
- "Export All" button removed from explore page header
- Back buttons removed from settings sidebar (redundant with unified nav)

### Layout Approach
**Use flex layout, not sticky positioning:**
- Avoids height calculations
- No z-index hacks
- Header never hides content
- Clean separation of scrollable content

```css
.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}

.app-layout__content {
  flex: 1;
  overflow-y: auto;
}
```

### Scroll Behavior
- Prevent default on anchor clicks
- Use `scrollIntoView({ behavior: 'smooth' })` for sidebar nav
- IntersectionObserver must use `.app-layout__content` as root (not viewport)

---

## Expert UX Notes

### Layout Principles
1. **Flex over sticky** - Flex layouts are more predictable and don't require magic numbers for heights
2. **Scroll containers** - When using flex layouts with `overflow-y: auto`, remember that IntersectionObserver and native anchor scrolling need the correct root element
3. **Same-tab navigation** - For related pages in an extension, same-tab navigation feels more app-like

### Accessibility Considerations
- `--accent-text` ensures WCAG contrast on accent backgrounds
- Smooth scrolling respects user preferences via CSS
- Focus states should remain visible (uses `--shadow-focus`)

### Theme Support
When adding new themes, ensure:
1. All color variables are defined
2. `--accent-text` provides readable contrast on `--accent-primary`
3. Status colors (success, error, warning, info) have appropriate bg/text/border

### Component Patterns

#### App Header
```html
<header class="app-header">
  <div class="app-header__brand">
    <h1 class="app-header__title">Brand Name</h1>
  </div>
  <nav class="app-header__nav">
    <a class="app-header__nav-link active">Tab 1</a>
    <a class="app-header__nav-link">Tab 2</a>
  </nav>
  <div class="app-header__actions">
    <!-- Optional action buttons -->
  </div>
</header>
```

#### Page Layout
```html
<body class="app-layout">
  <header class="app-header">...</header>
  <div class="app-layout__content">
    <!-- Scrollable content here -->
  </div>
</body>
```

### Future Considerations
- Consider adding loading skeletons for async content
- Toast notifications could replace alert() calls
- Mobile breakpoints may need refinement
- Keyboard navigation for sidebar could be improved
- Consider reduced-motion media query for animations

---

## Files Modified

### Core Design System
- `src/shared/theme.css` - Design tokens, unified components, theme variables

### Explore Page
- `src/explore/explore.html` - App layout wrapper, unified header
- `src/explore/explore.css` - Design token integration
- `src/explore/explore.ts` - Navigation handlers, removed export all

### Settings Page
- `src/options/options.html` - App layout wrapper, unified header
- `src/options/options.css` - Design token integration, layout fixes
- `src/options/options.ts` - Navigation handlers, scroll behavior fixes

### Popup
- `src/popup/popup.html` - Updated branding, removed settings button
- `src/popup/popup.css` - Design token integration
- `src/popup/popup.ts` - Removed settings button handler

### Tests
- `tests/extension.test.ts` - Removed settingsBtn selector check

# UX Redesign

## Vision

Transform **Bookmarks by Localforge** into a knowledge discovery tool with four unified experiences: **Library**, **Search**, **Stumble**, and **Settings**. All pages share consistent visual hierarchy, layout patterns, and a unified detail panel.

---

## Design Principles

1. **Consistent structure** - Every page follows Sidebar + Content + Detail Panel
2. **Flat organization** - Tags, not folders
3. **Discovery-first** - Stumble resurfaces forgotten knowledge
4. **Unified interaction** - Same detail panel slides in across all listing pages
5. **Progressive disclosure** - Summary in list, full content in panel

---

## Information Architecture

```
                              ┌─────────────┐
                              │   POPUP     │
                              │  (capture)  │
                              └──────┬──────┘
                                     │
        ┌────────────┬───────────────┼───────────────┬────────────┐
        ▼            ▼               ▼               ▼            │
   ┌─────────┐  ┌─────────┐    ┌─────────┐    ┌─────────┐         │
   │ LIBRARY │  │ SEARCH  │    │ STUMBLE │    │SETTINGS │         │
   │         │  │         │    │         │    │         │         │
   │ Browse  │  │ Semantic│    │ Random  │    │ Config  │         │
   │ + Tags  │  │ Query   │    │ Discover│    │ + Data  │         │
   └─────────┘  └─────────┘    └─────────┘    └─────────┘         │
        │            │               │               │            │
        └────────────┴───────┬───────┴───────────────┘            │
                             │                                    │
                    ┌────────┴────────┐                           │
                    │  DETAIL PANEL   │ ◄─────────────────────────┘
                    │ (shared across  │
                    │  all listings)  │
                    └─────────────────┘
```

---

## Global Header

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐    Bookmarks by       │
│  │ Library │ │ Search  │ │ Stumble │ │ Settings │      Localforge       │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘                       │
│   ▔▔▔▔▔▔▔▔▔                                                             │
│   (active)                                                              │
└─────────────────────────────────────────────────────────────────────────┘
       56px height, 16px horizontal padding
```

Navigation follows F-pattern reading with left-aligned nav tabs and right-aligned brand.

---

## Date Formatting Rules

Dates are displayed contextually based on age:
- **< 2 weeks**: Relative time (e.g., "2h ago", "3 days ago")
- **< 12 months**: Month and day (e.g., "Oct 12")
- **≥ 12 months**: Full date (e.g., "2024-12-24")

This applies consistently across Library cards, Search results, Stumble cards, and Detail panels.

---

## 1. POPUP (Capture)

Minimal popup focused on the primary action. Processing status is shown in Library, not here.

```
┌─────────────────────────────────────┐
│  Bookmarks by Localforge            │   48px
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │   📌  Save This Page        │    │   56px
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
├─────────────────────────────────────┤
│  ┌───────┐┌───────┐┌───────┐┌───┐   │
│  │Library││Search ││Stumble││ ⚙️ │   │   40px
│  └───────┘└───────┘└───────┘└───┘   │
└─────────────────────────────────────┘
         Width: 320px
         Height: ~180px
```

---

## 2. LIBRARY (Browse & Organize)

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Library] [Search] [Stumble] [Settings]             Bookmarks by Localforge│
├────────────┬────────────────────────────────┬───────────────────────────────┤
│            │                                │                               │
│  TAGS      │  BOOKMARKS              Sort ▼ │  DETAIL PANEL                 │
│            │                                │                               │
│  All   156 │ ┌────────────────────────────┐ │  Article Title                │
│  Untagged  │ │ Title of Article        ●  │ │  ───────────────────────────  │
│        23  │ │ example.com · #work #learn │ │  example.com                  │
│  ────────  │ └────────────────────────────┘ │  2 hours ago · Complete       │
│  #work  24 │                                │                               │
│  #learn 18 │ ┌────────────────────────────┐ │  TAGS                         │
│  #read  45 │ │ Another Article        ◐67%│ │  ┌──────┐ ┌──────────┐        │
│  #ref   32 │ │ github.com · #tutorial     │ │  │#work │ │#learning │        │
│            │ └────────────────────────────┘ │  └──────┘ └──────────┘        │
│            │                                │  (click to edit, type to add) │
│            │ ┌────────────────────────────┐ │                               │
│            │ │ Research Paper          ○  │ │  ───────────────────────────  │
│            │ │ arxiv.org                  │ │                               │
│            │ └────────────────────────────┘ │  Markdown content rendered    │
│            │                                │  with proper typography...    │
│            │                                │                               │
│            │                                │  ───────────────────────────  │
│            │                                │                               │
│            │                                │  Q&A PAIRS (5)                │
│            │                                │                               │
│            │                                │  Q: What is the main idea?    │
│            │                                │  A: The article explains...   │
│            │                                │                               │
│            │                                │  ───────────────────────────  │
│            │                                │  [Debug] [Export] [Delete]    │
│   200px    │           350px                │  flex: 1 (max width 960px)    │
└────────────┴────────────────────────────────┴───────────────────────────────┘
```

### Sidebar: Tags

```
TAGS

All                156
Untagged            23
────────────────────────
#work               24
#learning           18
#reading            45
#reference          32
#tutorial           14
```

- **All**: Every bookmark
- **Untagged**: Bookmarks with no tags (helps organization)
- **User tags**: Alphabetically sorted

### Bookmark Card (Desktop)

Optimized horizontal space with status right-aligned on title row:

```
┌──────────────────────────────────────────────┐
│ Title of the Article                      ●  │  ← Status right-aligned
│ example.com · 2h ago · #work #learning       │  ← URL, time, tags inline
└──────────────────────────────────────────────┘
```

**Status indicators:**
- `○` Pending (gray)
- `◐` Processing with % (blue)
- `●` Complete (green)
- `✕` Error (red)

### Bookmark Card (Mobile)

When space is constrained, stack vertically:

```
┌────────────────────────────────┐
│ Title of the Article        ●  │  ← Color dot only
│ example.com · Oct 12           │
│ #work #learning                │
└────────────────────────────────┘
```

### Tag Editing in Detail Panel

Click on tags section to enter edit mode. Type to filter existing tags or create new ones:

```
TAGS
┌─────────────────────────────────────────┐
│#work | #learning | type to add...       │
└─────────────────────────────────────────┘
                              │
                              ▼ (autocomplete dropdown)
                      ┌─────────────────────────┐
                      │ #tutorial               │
                      │ #reference              │
                      │ ─────────────────────── │
                      │ Create "newtagname"     │
                      └─────────────────────────┘
```

- Type in input to filter/create
- Normal input erasing with backspace drops tags
- Enter or click to add
- Creates tag automatically if doesn't exist

---

## 3. SEARCH (Semantic Query)

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Library] [Search] [Stumble] [Settings]            Bookmarks by Localforge │
├────────────┬────────────────────────────────┬───────────────────────────────┤
│            │                                │                               │
│  FILTERS   │  ┌──────────────────────────┐  │  DETAIL PANEL                 │
│            │  │ Ask anything...       🔍 │  │                               │
│  Tags:     │  └──────────────────────────┘  │  (same as Library)            │
│  ☑ Select All │                             │                               │
│  ☐ #work   │                                │                               │
│  ☐ #learn  │  12 results · Relevance ▼      │                               │
│  ☐ #read   │                                │                               │
│  ☐ #ref    │ ┌────────────────────────────┐ │                               │
│            │ │ 94%  Neural Networks    ●  │ │                               │
│  ────────  │ │ arxiv.org · #research #ml  │ │                               │
│            │ │ Oct 12                      │ │                               │
│  Status:   │ │                            │ │                               │
│  ☑ Select all│ │ Q: What are the components │ │                               │
│  ☐ Complete│ │    of neural networks?     │ │                               │
│  ☐ Pending │ │ A: Neural networks consist │ │                               │
│  ☐ Error   │ │    of layers of nodes...   │ │                               │
│            │ └────────────────────────────┘ │                               │
│            │                                │                               │
│            │ ┌────────────────────────────┐ │                               │
│            │ │ 87%  Deep Learning      ●  │ │                               │
│            │ │ deeplearning.ai · #tutorial│ │                               │
│            │ │ 3 days ago                  │ │                               │
│            │ │                             │ │                               │
│            │ │ Q: How does gradient       │ │                               │
│            │ │    descent work?           │ │                               │
│            │ │ A: Gradient descent        │ │                               │
│            │ │    iteratively adjusts...  │ │                               │
│            │ └────────────────────────────┘ │                               │
│            │                                │                               │
│   200px    │           flex: 1              │         flex: 1 (max 680px)   │
└────────────┴────────────────────────────────┴───────────────────────────────┘
```

### Sidebar: Filters

```
FILTERS

Tags:
☑ Select all
☐ #work
☐ #learning
☐ #reading
☐ #reference
☐ #tutorial

────────────────────────

Status:
☑ Select all
☐ Complete
☐ Pending
☐ Error
```

Checkboxes for multi-select filtering. Matches Library sidebar pattern. Select all toggling/untoggling clears all the rest.

### Search Result Card

Shows relevance percentage, date, and best matching Q&A:

```
┌──────────────────────────────────────────────────┐
│ 94%  Introduction to Neural Networks          ●  │
│ arxiv.org · #research #ml · Oct 12               │
│                                                  │
│ Q: What are the fundamental components?          │
│ A: Neural networks consist of interconnected     │
│    layers of nodes including input, hidden...    │
└──────────────────────────────────────────────────┘
```

Click card to open detail panel (same panel as Library).

### Search History

- Stored in database
- Only shown as autocomplete
- Setting to enable/disable autocomplete suggestions, erase history

---

## 4. STUMBLE (Random Discovery)

### Layout

Matches Library structure exactly. Simple shuffle action at top, in line with shuffle button, shuffle button on right align, show results on left align

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Library] [Search] [Stumble] [Settings]             Bookmarks by Localforge│
├────────────┬────────────────────────────────┬───────────────────────────────┤
│            │                                │                               │
│  FILTER    │  ┌──────────────────────────┐  │  DETAIL PANEL                 │
│            │  │  ↻ Shuffle               │  │                               │
│  Tags:     │  └──────────────────────────┘  │  (same as Library)            │
│  ☑ Select all │  Showing 10 random bookmarks   │                            │
│  ☐ #work   │                                │                               │
│  ☐ #learn  │ ┌────────────────────────────┐ │                               │
│  ☐ #read   │ │ WebSockets Guide        ●  │ │                               │
│  ☐ #ref    │ │ mozilla.org · #reference   │ │                               │
│  ☐ #tutor  │ │ Saved 3 months ago          │ │                               │
│            │ │                             │ │                               │
│            │ │ Q: When use WebSockets vs   │ │                               │
│            │ │    HTTP polling?            │ │                               │
│            │ │ A: WebSockets are ideal for │ │                               │
│            │ │    real-time bidirectional..│ │                               │
│            │ └────────────────────────────┘ │                               │
│            │                                │                               │
│            │ ┌────────────────────────────┐ │                               │
│            │ │ Readable Code           ●  │ │                               │
│            │ │ oreilly.com · #reading     │ │                               │
│            │ │ Saved 6 months ago          │ │                               │
│            │ │                             │ │                               │
│            │ │ Q: What is the "newspaper" │ │                               │
│            │ │    code organization?       │ │                               │
│            │ │ A: Like a newspaper, code   │ │                               │
│            │ │    should have important... │ │                               │
│            │ └────────────────────────────┘ │                               │
│            │                                │                               │
│   200px    │           flex: 1              │         flex: 1 (max 680px)   │
└────────────┴────────────────────────────────┴───────────────────────────────┘
```

### Sidebar: Filter

```
FILTER

Tags:
☑ Select all
☐ #work
☐ #learning
☐ #reading
☐ #reference
☐ #tutorial
```

Same checkbox pattern as Search. Filter limits random selection to checked tags. Selecting all clears all the rest.

### Stumble Card

Shows "Saved X ago" instead of relevance, plus one random Q&A:

```
┌──────────────────────────────────────────────────┐
│ Understanding WebSockets                      ●  │
│ developer.mozilla.org · #reference #webdev       │
│ Saved 3 months ago                               │
│                                                  │
│ Q: When should you use WebSockets?               │
│ A: WebSockets are ideal for real-time            │
│    bidirectional communication...                │
└──────────────────────────────────────────────────┘
```

Click card to open detail panel.

### Algorithm

```typescript
async function getStumbleBookmarks(
  selectedTags: string[],
  count: number = 10
): Promise<StumbleItem[]> {
  let bookmarks = await db.bookmarks
    .where('status').equals('complete')
    .toArray();

  // Filter by selected tags if any
  if (selectedTags.length > 0) {
    const taggedBookmarkIds = await db.bookmarkTags
      .where('tagName').anyOf(selectedTags)
      .primaryKeys()
      .then(keys => [...new Set(keys.map(k => k[0]))]);
    bookmarks = bookmarks.filter(b => taggedBookmarkIds.includes(b.id));
  }

  // Fisher-Yates shuffle
  for (let i = bookmarks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bookmarks[i], bookmarks[j]] = [bookmarks[j], bookmarks[i]];
  }

  const selected = bookmarks.slice(0, count);

  // Get one random Q&A for each
  return Promise.all(selected.map(async (bookmark) => {
    const qaPairs = await db.questionAnswers
      .where('bookmarkId').equals(bookmark.id)
      .toArray();
    const randomQA = qaPairs[Math.floor(Math.random() * qaPairs.length)];
    return { bookmark, qa: randomQA };
  }));
}
```

---

## 5. SETTINGS (Configuration)

### Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  [Library] [Search] [Stumble] [Settings]             Bookmarks by Localforge│
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  SECTIONS  │  APPEARANCE                                                    │
│            │  ───────────────────────────────────────────────────────────   │
│  ● Appear. │                                                                │
│  ○ API     │  Theme                                                         │
│  ○ Data    │                                                                │
│  ○ About   │  Choose your preferred appearance.                             │
│            │                                                                │
│            │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────┐     │
│            │  │  Auto  │ │ Light  │ │  Dark  │ │ Terminal │ │ Tufte  │     │
│            │  └────────┘ └────────┘ └────────┘ └──────────┘ └────────┘     │
│            │      ●          ○          ○            ○           ○          │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│   200px    │                        flex: 1 (max 680px)                     │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### Sections

**Appearance**
```
APPEARANCE
───────────────────────────────────────────────────

Theme

Choose your preferred appearance. Auto follows system.

┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────┐
│  Auto  │ │ Light  │ │  Dark  │ │ Terminal │ │ Tufte  │
└────────┘ └────────┘ └────────┘ └──────────┘ └────────┘
    ●          ○          ○            ○           ○

───────────────────────────────────────────────────

Search

☐ Enable search autocomplete suggestions
  (uses recent search history)
```

**API Configuration**
```
API CONFIGURATION
───────────────────────────────────────────────────

API Base URL
┌───────────────────────────────────────────────┐
│ https://api.openai.com/v1                     │
└───────────────────────────────────────────────┘

API Key
┌───────────────────────────────────────────────┐
│ sk-••••••••••••••••••••••••••••••••           │
└───────────────────────────────────────────────┘

┌─────────────────────┐  ┌─────────────────────┐
│ Chat Model          │  │ Embedding Model     │
│ gpt-4o-mini         │  │ text-embedding-3-sm │
└─────────────────────┘  └─────────────────────┘

[Save Settings]  [Test Connection]
```

**Data Management**
```
DATA MANAGEMENT
───────────────────────────────────────────────────

Import

┌─────────────────────┐  ┌─────────────────────┐
│ 📁 Import from File │  │ 🔗 Import URLs      │
└─────────────────────┘  └─────────────────────┘

Export

┌─────────────────────┐  ┌─────────────────────┐
│ () Export All       │  │ () Export Settings  │
└─────────────────────┘  └─────────────────────┘

───────────────────────────────────────────────────

Processing Queue

2 items processing

┌───────────────────────────────────────────────┐
│ Article Title                        67% ████░│
│ Generating Q&A pairs...                       │
├───────────────────────────────────────────────┤
│ Another Article                       Pending │
└───────────────────────────────────────────────┘
```

**About**
```
ABOUT
───────────────────────────────────────────────────

Bookmarks by Localforge
Version 3.4.0

───────────────────────────────────────────────────

Your bookmarks are stored locally. Only extracted
content is sent to your configured API.

[Website]  [Source code]  [Report Issue]
```

---

## Shared Detail Panel

The same detail panel component is used across Library, Search, and Stumble. It slides in from the right when a card is clicked.

```
┌─────────────────────────────────────────┐
│  ← Back                                 │
├─────────────────────────────────────────┤
│                                         │
│  Article Title                          │
│  ─────────────────────────────────────  │
│  example.com/path/to/article            │
│  Saved 2 hours ago · Complete           │
│                                         │
│  TAGS                                   │
│  ┌──────┐ ┌──────────┐ ┌─────────────┐  │
│  │#work │ │#learning │ │ add tag...  │  │
│  └──────┘ └──────────┘ └─────────────┘  │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  ## Markdown Content                    │
│                                         │
│  Full article content rendered with     │
│  proper typography and spacing...       │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  Q&A PAIRS (5)                          │
│                                         │
│  Q: What is the main concept?           │
│  A: The article explains...             │
│                                         │
│  Q: What are the benefits?              │
│  A: Three main benefits include...      │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  [Debug HTML]  [Export]  [Delete]       │
│                                         │
└─────────────────────────────────────────┘
```

---

## Data Model

### BookmarkTags Table

Tags are stored directly in the BookmarkTags table (no separate Tags table):

```typescript
interface BookmarkTag {
  bookmarkId: string;
  tagName: string;     // Tag stored directly, lowercase, hyphens for spaces
  addedAt: Date;
}
```

### SearchHistory Table

```typescript
interface SearchHistory {
  id: string;
  query: string;
  resultCount: number;
  createdAt: Date;
}
```

### Schema v3

```typescript
db.version(3).stores({
  bookmarks: 'id, url, status, createdAt, updatedAt',
  markdown: 'id, bookmarkId, createdAt, updatedAt',
  questionAnswers: 'id, bookmarkId, createdAt, updatedAt',
  jobs: 'id, bookmarkId, parentJobId, status, type, [parentJobId+status], [bookmarkId+type]',
  settings: 'key, createdAt, updatedAt',
  bookmarkTags: '[bookmarkId+tagName], bookmarkId, tagName, addedAt',
  searchHistory: 'id, query, createdAt'
});
```

---

## Responsive Breakpoints

| Breakpoint | Width | Layout |
|------------|-------|--------|
| Desktop | ≥1200px | Sidebar (200) + List (350) + Detail (flex) |
| Laptop | 900-1199px | Sidebar (180) + List (300) + Detail (flex) |
| Tablet | 600-899px | Sidebar as drawer + List, Detail as overlay |
| Mobile | <600px | Sidebar as dropdown, List full, Detail full screen |


---

## Testing Requirements

Each advanced feature requires dedicated tests:

### Tag Editor Tests
- Display existing tags
- Remove tags via backspace
- Show autocomplete dropdown
- Filter autocomplete results
- Prevent duplicate tags

### Stumble Algorithm Tests
- Return exactly N bookmarks
- Only include complete bookmarks
- Filter by selected tags
- Return different results on shuffle
- Include one random Q&A per bookmark
- Handle empty collection
- Handle bookmarks with no Q&A pairs

### Search Tests
- Perform semantic search
- Filter by tag checkboxes
- Filter by status checkboxes
- Sort by relevance
- Store search in history
- Limit history entries

### Select All Toggle Tests
- Toggle clears/selects all options
- State persists across sessions
- Works independently for tags and status

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

---

## Expert UX Notes

### Accessibility Considerations
- `--accent-text` ensures WCAG contrast on accent backgrounds
- Smooth scrolling respects user preferences via CSS
- Focus states should remain visible (uses `--shadow-focus`)

### Theme Support
When adding new themes, ensure:
1. All color variables are defined
2. `--accent-text` provides readable contrast on `--accent-primary`
3. Status colors (success, error, warning, info) have appropriate bg/text/border

---

---

# Information Architecture Improvements: 10 Proposals

The following proposals address gaps in the current design, with particular focus on how job status inspection should feel like "looking under the hood" — a diagnostic view that ideally shows everything as complete, not a primary navigation concern.

---

## Improvement 1: System Health Indicator Instead of Jobs Dashboard

**Problem**: The current design buries jobs in Settings > Data Management, making it neither discoverable for debugging nor hidden enough for the "everything should work" scenario.

**Proposal**: Replace the prominent "Jobs Dashboard" with a **System Health Indicator** in the global header.

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  [Library] [Search] [Stumble] [Settings]      ●  Bookmarks by Localforge│
│                                               ↑                         │
│                                        Health indicator                 │
└─────────────────────────────────────────────────────────────────────────┘
```

**Health States:**
- `●` Green: All systems healthy, no pending jobs
- `◐` Blue pulse: Processing in progress (click to see details)
- `○` Gray: Idle, nothing processing
- `✕` Red: Errors need attention (click to see)

**Clicking the indicator** opens a "System Status" modal/drawer — the "under the hood" view.

---

## Improvement 2: "Under the Hood" Diagnostic Panel

**Problem**: Jobs dashboard is too detailed for casual users but lacks context for debugging.

**Proposal**: Create a dedicated **Diagnostics Panel** accessible only via the health indicator. This is the "mechanic's view."

```
┌───────────────────────────────────────────────────────┐
│  ⚙️ System Diagnostics                          ✕    │
├───────────────────────────────────────────────────────┤
│                                                       │
│  HEALTH SUMMARY                                       │
│  ─────────────────────────────────────────────────   │
│  ✓ API Connection: Healthy                           │
│  ✓ Local Storage: 234 MB used                        │
│  ✓ Processing Queue: Empty                           │
│                                                       │
│  ─────────────────────────────────────────────────   │
│                                                       │
│  RECENT ACTIVITY (last 24h)                          │
│  ─────────────────────────────────────────────────   │
│  ✓ 12 bookmarks processed successfully               │
│  ✓ 0 failures                                        │
│                                                       │
│  ─────────────────────────────────────────────────   │
│                                                       │
│  ▶ Show detailed job history                         │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Key insight**: The default view is a **health summary**, not a job list. Detailed job history is one click deeper ("Show detailed job history"), reinforcing that this is diagnostic territory.

---

## Improvement 3: Progressive Disclosure for Job Details

**Problem**: Current jobs dashboard shows all job types equally, creating noise.

**Proposal**: Three-tier progressive disclosure:

```
Level 1: Health indicator (global header)
    ↓ click
Level 2: Health summary (what you see above)
    ↓ "Show detailed job history"
Level 3: Full job timeline (the current jobs dashboard, but cleaner)
```

**Level 3 Layout:**

```
┌───────────────────────────────────────────────────────┐
│  ← Back to Summary                                    │
├───────────────────────────────────────────────────────┤
│                                                       │
│  JOB TIMELINE                          Filter ▼      │
│                                                       │
│  Today                                                │
│  ─────────────────────────────────────────────────   │
│  14:32  ✓ Understanding React Hooks                  │
│            Processed in 4.2s                         │
│                                                       │
│  14:30  ✓ CSS Grid Complete Guide                    │
│            Processed in 3.8s                         │
│                                                       │
│  Yesterday                                            │
│  ─────────────────────────────────────────────────   │
│  ...                                                  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Jobs are grouped by date, collapsed by default, showing only title + time + status. Expand for details.

---

## Improvement 4: Inline Processing Status in Library Cards

**Problem**: Users must navigate to Jobs Dashboard to see what's processing.

**Proposal**: Processing status is **inline** in Library, but details are "under the hood."

```
┌──────────────────────────────────────────────────┐
│ Understanding React Hooks                   ◐ 67%│
│ reactjs.org · 2m ago                             │
│ Generating Q&A pairs...                          │  ← Inline step indicator
└──────────────────────────────────────────────────┘
```

**Click the processing indicator (◐)** to see the bookmark's job details in a tooltip or mini-panel — not a full page navigation.

```
┌────────────────────────────────┐
│ Processing: 67%                │
│ ─────────────────────────────  │
│ ✓ Page captured                │
│ ✓ Content extracted (2,340 ch) │
│ ● Generating Q&A pairs...      │
│ ○ Creating embeddings          │
└────────────────────────────────┘
```

---

## Improvement 5: Contextual Job Information in Detail Panel

**Problem**: Bookmark detail panel lacks processing metadata.

**Proposal**: Add an expandable "Processing Info" section at the bottom of the detail panel (collapsed by default).

```
┌─────────────────────────────────────────┐
│  ...                                    │
│                                         │
│  ─────────────────────────────────────  │
│                                         │
│  [Debug HTML]  [Export]  [Delete]       │
│                                         │
│  ▶ Processing Info                      │  ← Collapsed by default
│                                         │
└─────────────────────────────────────────┘
```

**Expanded:**

```
│  ▼ Processing Info                      │
│  ─────────────────────────────────────  │
│  Captured: Dec 15, 2024 at 2:32 PM      │
│  Processing time: 4.2 seconds           │
│  Content: 2,340 characters              │
│  Q&A pairs: 5 generated                 │
│  Embeddings: 1536 dimensions            │
│  Status: Complete ✓                     │
```

This is the "under the hood" info for a specific bookmark.

---

## Improvement 6: Error Recovery Flow, Not Error Dashboard

**Problem**: Failed jobs appear in a dashboard list, requiring manual intervention.

**Proposal**: Errors should surface **in context** with clear recovery actions.

**In Library (inline error):**

```
┌──────────────────────────────────────────────────┐
│ Article That Failed                          ✕   │
│ example.com · 2h ago                             │
│ ⚠️ Processing failed · [Retry] [View Details]    │
└──────────────────────────────────────────────────┘
```

**Health indicator shows red**, clicking reveals:

```
┌───────────────────────────────────────────────────────┐
│  ⚠️ 2 items need attention                     ✕     │
├───────────────────────────────────────────────────────┤
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Article That Failed                             │ │
│  │ API rate limit exceeded                         │ │
│  │ [Retry Now]  [Retry All]  [Dismiss]            │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Another Failed Article                          │ │
│  │ Network timeout                                  │ │
│  │ [Retry Now]  [Dismiss]                          │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
└───────────────────────────────────────────────────────┘
```

Errors are **actionable**, not just informational.

---

## Improvement 7: Bulk Import as a Wizard, Not a Form

**Problem**: Bulk import in Settings feels disconnected from results.

**Proposal**: Replace the bulk import form with a **guided wizard** that shows progress inline.

**Step 1: Input**
```
┌───────────────────────────────────────────────────────┐
│  Import URLs                                    ✕     │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Paste URLs (one per line)                           │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://example.com/article1                    │ │
│  │ https://example.com/article2                    │ │
│  │ ...                                             │ │
│  └─────────────────────────────────────────────────┘ │
│                                                       │
│  ✓ 15 valid URLs · 2 duplicates will be skipped      │
│                                                       │
│  [Cancel]                        [Import 15 URLs →]  │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Step 2: Progress (same modal)**
```
┌───────────────────────────────────────────────────────┐
│  Importing URLs                                 ✕     │
├───────────────────────────────────────────────────────┤
│                                                       │
│  Progress: 8 of 15                                   │
│  ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░  53%         │
│                                                       │
│  ✓ example.com/article1                              │
│  ✓ example.com/article2                              │
│  ✓ example.com/article3                              │
│  ● example.com/article4 (fetching...)               │
│  ○ example.com/article5                              │
│  ...                                                 │
│                                                       │
│  [Run in Background]                    [Cancel]     │
│                                                       │
└───────────────────────────────────────────────────────┘
```

**Step 3: Complete**
```
│  ✓ Import Complete!                                  │
│                                                       │
│  Successfully imported: 14                           │
│  Failed: 1 (network error)                           │
│                                                       │
│  [View in Library]              [Import More]        │
```

---

## Improvement 8: Status Filter as a Secondary Concern in Library

**Problem**: Current design has status filters in Search sidebar, but not Library.

**Proposal**: Add a subtle **status filter** in Library, but default to "All" (including processing).

```
TAGS                              │  BOOKMARKS        All ▼  Sort ▼
                                  │
All               156             │  ┌─ All ──────────────────────┐
Untagged           23             │  │ ✓ All (156)                │
────────────────────              │  │   Complete (142)           │
#work              24             │  │   Processing (3)           │
#learning          18             │  │   Pending (8)              │
...                               │  │   Errors (3)               │
                                  │  └─────────────────────────────┘
```

This keeps the focus on content (tags) while allowing status filtering when needed.

---

## Improvement 9: Activity Feed in Popup for Quick Glance

**Problem**: Popup only shows save action and stats. Users open the full UI to check status.

**Proposal**: Add a minimal **activity feed** to the popup.

```
┌─────────────────────────────────────┐
│  Bookmarks by Localforge            │
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │   📌  Save This Page        │    │
│  └─────────────────────────────┘    │
│                                     │
│  RECENT ACTIVITY                    │
│  ─────────────────────────────────  │
│  ✓ React Hooks Guide        · 2m   │
│  ◐ CSS Grid Tutorial    67% · now  │
│                                     │
├─────────────────────────────────────┤
│  [Library] [Search] [Stumble] [⚙️]  │
└─────────────────────────────────────┘
```

This gives a **quick glance** at what's happening without leaving the popup.

---

## Improvement 10: Unified "Activity" Mental Model

**Problem**: Jobs, processing status, and recent bookmarks are separate concepts in the current design.

**Proposal**: Unify under an **"Activity"** mental model with these states:

| State | Icon | Meaning | Where Visible |
|-------|------|---------|---------------|
| Saving | ◌ | Being captured | Popup activity |
| Pending | ○ | Queued for processing | Library cards, Popup |
| Processing | ◐ | AI is working | Library cards, Popup, Health indicator |
| Complete | ● | Ready to search | Library cards (default) |
| Error | ✕ | Needs attention | Health indicator, Library cards |

**Key insight**: "Jobs" is an implementation detail. Users think in terms of "What's happening to my bookmark?" The activity model answers that question at every touchpoint.

---

## Summary: The "Under the Hood" Paradigm

These improvements follow a core principle: **When everything works, the machinery should be invisible.**

1. **Health indicator** (global) — Ambient awareness
2. **Inline status** (Library cards) — Context-aware progress
3. **Diagnostics panel** (via health indicator) — Intentional deep dive
4. **Detail panel processing info** (collapsed) — Bookmark-specific details
5. **Error recovery flow** — Actionable, not just informational

The Jobs Dashboard transforms from a primary navigation destination into a **diagnostic tool** that power users can access when they need to debug. For most users, they'll see the green health indicator and never think about jobs at all.

```
USER JOURNEY (happy path):
  Save page → See ◐ in Library → Wait → See ● → Search!

USER JOURNEY (debugging):
  See ✕ in header → Click → "2 items need attention" →
  [Retry All] → See ◐ → Wait → See ● → Problem solved!

USER JOURNEY (power user):
  Want to know details → Click health indicator →
  "Show detailed job history" → Full timeline view
```

This is "looking under the hood" — you lift it when something sounds wrong, not as part of daily driving.

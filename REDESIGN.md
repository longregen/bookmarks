# UX Redesign: Complete Overhaul

## Vision

Transform **Bookmarks by Localforge** into a knowledge discovery tool with four unified experiences: **Library**, **Search**, **Stumble**, and **Settings**. All pages share a consistent visual hierarchy and layout philosophy.

---

## Design Philosophy

### Guiding Principles

1. **Consistent structure** - Every page follows the same visual hierarchy
2. **Flat organization** - Tags, not folders
3. **Discovery-first** - Stumble makes old knowledge resurface
4. **Progressive disclosure** - Show summary first, details on demand
5. **Balanced density** - Neither cramped nor wasteful of space

### Layout Philosophy

Every main page follows the **Sidebar + Content** pattern:

```
┌──────────────────────────────────────────────────────────────────┐
│  [Library]  [Search]  [Stumble]  [Settings]      Brand Name    ⚙️ │
├──────────────┬───────────────────────────────────────────────────┤
│              │                                                   │
│   SIDEBAR    │                    CONTENT                        │
│   (context)  │                    (main focus)                   │
│              │                                                   │
│   ~200px     │                    flex: 1                        │
│   fixed      │                    scrollable                     │
│              │                                                   │
└──────────────┴───────────────────────────────────────────────────┘
```

**Rationale**: Sidebars provide persistent context and navigation while the content area adapts to each page's needs. This creates visual consistency and reduces cognitive load when switching between pages.

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
   │ Browse  │  │ Query   │    │ Random  │    │ Config  │         │
   │ + Tags  │  │ + Find  │    │ + Disc. │    │ + Data  │         │
   └─────────┘  └─────────┘    └─────────┘    └─────────┘         │
        │            │               │               │            │
        └────────────┴───────────────┴───────────────┘            │
                              │                                    │
                              └────────────────────────────────────┘
                                    (all interconnected)
```

---

## Global Header

### Design

```
┌─────────────────────────────────────────────────────────────────────────┐
│                                                                         │
│  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌──────────┐     Bookmarks by     │
│  │ Library │ │ Search  │ │ Stumble │ │ Settings │       Localforge     │
│  └─────────┘ └─────────┘ └─────────┘ └──────────┘                       │
│   ▔▔▔▔▔▔▔▔▔                                                             │
│   (active)                                                               │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

### Layout Analysis

**Option A: Left-aligned nav, right-aligned brand**
```
[Library] [Search] [Stumble] [Settings]              Bookmarks by Localforge
```

| Pros | Cons |
|------|------|
| Nav is first thing eye sees (F-pattern) | Brand feels disconnected |
| Settings grouped with main nav | More horizontal space needed |
| Clear visual hierarchy | |

**Option B: Centered nav, left brand** ✓ RECOMMENDED
```
Bookmarks         [Library] [Search] [Stumble] [Settings]
```

| Pros | Cons |
|------|------|
| Brand anchors the header | Nav not at eye's starting point |
| Balanced visual weight | |
| Nav items are equidistant from center | |

**Option C: Split - brand left, settings right**
```
Bookmarks         [Library] [Search] [Stumble]              ⚙️
```

| Pros | Cons |
|------|------|
| Settings has dedicated space | Settings feels secondary |
| Clean separation | Inconsistent nav grouping |

**Decision**: Option B - centered nav creates balance and treats all four sections as equals.

### Vertical Space Analysis

**Header height options:**

| Height | Assessment |
|--------|------------|
| 48px | Too cramped, touch targets too small |
| 56px | ✓ Good balance, standard app bar height |
| 64px | Acceptable, more breathing room |
| 72px+ | Wastes vertical space, pushes content down |

**Decision**: 56px header height with 16px horizontal padding.

---

## 1. POPUP (Capture Point)

### Purpose
Quick capture of current page + navigation to main experiences.

### Design

```
┌─────────────────────────────────────┐
│  Bookmarks by Localforge            │  48px header
├─────────────────────────────────────┤
│                                     │
│  ┌─────────────────────────────┐    │
│  │                             │    │
│  │   📌  Save This Page        │    │  56px button
│  │                             │    │
│  └─────────────────────────────┘    │
│                                     │
│  ┌─────────────────────────────┐    │
│  │██████████░░░░░░░░░░░░░░░░░░░│    │  Processing bar
│  │ 2 processing · 34%          │    │  (only if items pending)
│  └─────────────────────────────┘    │
│                                     │
├─────────────────────────────────────┤
│  ┌───────┐┌───────┐┌───────┐┌───┐   │
│  │Library││Search ││Stumble││ ⚙️ │   │  40px nav row
│  └───────┘└───────┘└───────┘└───┘   │
└─────────────────────────────────────┘
        Width: 320px
```

### Layout Analysis

**Popup width options:**

| Width | Assessment |
|-------|------------|
| 280px | Too narrow, text truncates |
| 300px | Tight but workable |
| 320px | ✓ Standard popup width, comfortable |
| 360px | Generous, may feel oversized |
| 400px+ | Too wide for a popup |

**Vertical layout rationale:**

1. **Brand header** (48px) - Establishes identity
2. **Primary action** (56px + padding) - Hero element, most important
3. **Processing status** (conditional, ~40px) - Only shown when relevant
4. **Navigation** (40px) - Secondary actions, bottom placement

**Total height**: ~200px (without processing) or ~240px (with processing)

| Pros of this layout | Cons |
|---------------------|------|
| Primary action is clearly dominant | Processing bar may cause layout shift |
| Navigation is accessible but not competing | Four nav items may feel cramped |
| Conditional processing saves space | |

**Alternative considered: Horizontal nav at top**
```
┌─────────────────────────────────────┐
│ [Lib] [Srch] [Stmbl] [⚙️]  Bookmarks│
├─────────────────────────────────────┤
│        📌 Save This Page            │
│        Processing: 2 · 34%          │
└─────────────────────────────────────┘
```

| Pros | Cons |
|------|------|
| More compact | Save button less prominent |
| Nav immediately accessible | Brand competes with nav |

**Decision**: Keep primary action prominent with bottom navigation.

---

## 2. LIBRARY (Browse & Organize)

### Purpose
Browse all bookmarks, filter by tags, view details.

### Design: Three-Column Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Bookmarks         [Library] [Search] [Stumble] [Settings]                  │
├────────────┬────────────────────────────────┬───────────────────────────────┤
│            │                                │                               │
│  TAGS      │  BOOKMARKS                     │  DETAIL                       │
│            │                                │                               │
│  All   156 │  Sort: [Date ▼]                │  Article Title                │
│  Untagged  │                                │  ───────────────────────────  │
│        23  │  ┌────────────────────────┐    │  example.com                  │
│  ────────  │  │ Title of Article       │    │  2 hours ago · Complete       │
│  #work  24 │  │ example.com · 2h       │    │                               │
│  #learn 18 │  │ ● Complete             │    │  TAGS                         │
│  #read  45 │  │ #work #learn           │    │  [#work] [#learn] [+ Add]     │
│  #ref   32 │  └────────────────────────┘    │                               │
│            │                                │  ───────────────────────────  │
│            │  ┌────────────────────────┐    │                               │
│            │  │ Another Article        │    │  Markdown content rendered    │
│  + New tag │  │ github.com · 1d        │    │  with proper typography...    │
│            │  │ ◐ Processing 67%       │    │                               │
│            │  └────────────────────────┘    │  ───────────────────────────  │
│            │                                │                               │
│            │  ┌────────────────────────┐    │  Q&A PAIRS                    │
│            │  │ Research Paper         │    │                               │
│            │  │ arxiv.org · 3d         │    │  Q: What is the main idea?    │
│            │  │ ○ Pending              │    │  A: The article explains...   │
│            │  │ (untagged)             │    │                               │
│            │  └────────────────────────┘    │  ───────────────────────────  │
│            │                                │  [Debug] [Export] [Delete]    │
│   200px    │         350px                  │         flex: 1               │
└────────────┴────────────────────────────────┴───────────────────────────────┘
```

### Column Width Analysis

**Sidebar (Tags)**

| Width | Assessment |
|-------|------------|
| 160px | Too narrow, tag names truncate |
| 180px | Workable with short names |
| 200px | ✓ Comfortable, handles most tag names |
| 240px | Generous but wastes space |

**List Column**

| Width | Assessment |
|-------|------------|
| 280px | Cards feel cramped |
| 320px | Minimum comfortable width |
| 350px | ✓ Good balance for card content |
| 400px | Generous, pushes detail panel |

**Detail Panel**

| Approach | Assessment |
|----------|------------|
| Fixed 400px | Predictable but may waste space |
| flex: 1 | ✓ Adapts to viewport, max-width for readability |
| 50% of remaining | Proportional but complex |

**Decision**: 200px + 350px + flex:1 (min 400px, max 680px for readability)

### Sidebar Content Analysis

**What belongs in the sidebar?**

| Option | Include | Exclude |
|--------|---------|---------|
| Smart views (Recent, Processing) | ✗ | Creates artificial categories |
| All bookmarks | ✓ | Essential default view |
| Untagged | ✓ | Helps with organization |
| User tags | ✓ | Core navigation |
| Tag creation | ✓ | Convenient access |

**Sidebar layout:**

```
TAGS                    ← Section label

All                156  ← Total count, always first
Untagged            23  ← Helps find unorganized items
─────────────────────   ← Visual separator
#work               24  ← Alphabetical or by count?
#learning           18
#reading            45
#reference          32

+ New tag               ← Action at bottom
```

**Tag ordering options:**

| Order | Pros | Cons |
|-------|------|------|
| Alphabetical | Predictable, findable | Frequently used tags may be buried |
| By count (desc) | Popular tags surface | Order changes as you use it |
| Manual/drag | Full control | Requires user effort |
| Recent first | Fresh tags accessible | Older tags buried |

**Decision**: Alphabetical by default. Future: allow user preference.

### Bookmark Card Analysis

**Information density per card:**

```
┌──────────────────────────────────┐
│ Title of the Article (truncate)  │  ← Primary identifier
│ example.com · 2 hours ago        │  ← Context: source + recency
│ ● Complete                       │  ← Status
│ #work #learning                  │  ← Organization
└──────────────────────────────────┘
```

**Card height options:**

| Height | Content | Assessment |
|--------|---------|------------|
| 60px | Title + URL only | Too minimal, no status |
| 72px | + Status | Workable but tight |
| 88px | + Tags | ✓ Good balance |
| 100px+ | + Description | Too tall, fewer visible |

**Decision**: ~88px per card, allowing ~6-8 visible in typical viewport.

### Detail Panel Analysis

**Content hierarchy (top to bottom):**

1. **Title** - What is this?
2. **URL + Meta** - Where from? When saved?
3. **Tags** - How is it organized?
4. **Content** - The actual value
5. **Q&A Pairs** - AI-generated insights
6. **Actions** - What can I do?

**Tag management in detail panel:**

```
TAGS
┌──────┐ ┌──────────┐ ┌─────────────────┐
│#work │ │#learning │ │  + Add tag      │
└──────┘ └──────────┘ └─────────────────┘
```

| Approach | Pros | Cons |
|----------|------|------|
| Inline chips with + button | ✓ Compact, quick access | Limited space for many tags |
| Separate tag section | More room | Takes vertical space |
| Modal for tag management | Full control | Extra click, breaks flow |

**Decision**: Inline chips with "+ Add" that opens a dropdown. Remove tag by clicking × on chip.

### Three-Column Responsive Behavior

| Viewport | Layout |
|----------|--------|
| ≥1200px | Three columns: sidebar (200) + list (350) + detail (flex) |
| 900-1199px | Two columns: sidebar (200) + list (flex), detail slides over |
| <900px | One column: sidebar as dropdown, list full width, detail full screen |

---

## 3. SEARCH (Semantic Query)

### Purpose
Find bookmarks by asking questions. Shows relevance-ranked results with matching Q&A.

### Design: Sidebar + Results

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Bookmarks         [Library] [Search] [Stumble] [Settings]                  │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  SEARCH    │  ┌────────────────────────────────────────────────────────┐   │
│            │  │  Ask your knowledge base...                        🔍  │   │
│  Recent    │  └────────────────────────────────────────────────────────┘   │
│  queries:  │                                                                │
│            │  ───────────────────────────────────────────────────────────   │
│  "machine  │  12 results for "machine learning"    Sort: [Relevance ▼]     │
│   learning"│  ───────────────────────────────────────────────────────────   │
│            │                                                                │
│  "react    │  ┌────────────────────────────────────────────────────────┐   │
│   hooks"   │  │  94%   Introduction to Neural Networks                 │   │
│            │  │  ───   arxiv.org/abs/2024.12345                        │   │
│  "api      │  │        #research #ml                                   │   │
│   design"  │  │                                                        │   │
│            │  │        Q: What are the components of neural networks?  │   │
│  ────────  │  │        A: Neural networks consist of layers of nodes   │   │
│            │  │           including input, hidden, and output layers..│   │
│  FILTERS   │  │                                                        │   │
│            │  │        [Open in Library]                               │   │
│  Tags:     │  └────────────────────────────────────────────────────────┘   │
│  [All    ▼]│                                                                │
│            │  ┌────────────────────────────────────────────────────────┐   │
│  Status:   │  │  87%   Deep Learning Fundamentals                      │   │
│  [All    ▼]│  │  ───   deeplearning.ai/courses/fundamentals            │   │
│            │  │        #tutorial                                       │   │
│  ☑ Complete│  │                                                        │   │
│    only    │  │        Q: How does gradient descent work?              │   │
│            │  │        A: Gradient descent iteratively adjusts weights │   │
│            │  │           by computing gradients of the loss function..│   │
│            │  │                                                        │   │
│            │  │        [Open in Library]                               │   │
│            │  └────────────────────────────────────────────────────────┘   │
│            │                                                                │
│   200px    │                        flex: 1                                 │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### Layout Analysis

**Why sidebar instead of top filters?**

| Approach | Pros | Cons |
|----------|------|------|
| Sidebar | ✓ Consistent with Library | Takes horizontal space |
| | ✓ Filters always visible | |
| | ✓ Room for search history | |
| Top bar | More horizontal result space | Filters hidden or cramped |
| | Familiar pattern | Inconsistent with Library |

**Decision**: Sidebar maintains visual consistency across all pages.

### Sidebar Content

```
SEARCH              ← Section label

Recent queries:     ← Quick access to past searches
  "machine learning"
  "react hooks"
  "api design"
  "database index"

─────────────────

FILTERS             ← Refine results

Tags:
[All tags      ▼]   ← Dropdown to filter by tag

Status:
[All status    ▼]   ← Dropdown (All, Complete, Pending, Error)

☑ Complete only     ← Quick toggle for common filter
```

**Search history considerations:**

| Approach | Pros | Cons |
|----------|------|------|
| Last 5 queries | ✓ Quick, low clutter | May miss useful older queries |
| Last 10 queries | More options | Takes more space |
| Saved searches | User control | Requires explicit action |
| No history | Simpler | Loses convenience |

**Decision**: Show last 5 queries. Click to re-run. Clear all option.

### Result Card Analysis

**Information per result:**

```
┌────────────────────────────────────────────────────────────────┐
│  94%   Introduction to Neural Networks                         │
│  ───   arxiv.org/abs/2024.12345                                │
│        #research #ml                                           │
│                                                                │
│        Q: What are the fundamental components of neural nets?  │
│        A: Neural networks consist of interconnected layers of  │
│           nodes (neurons) including input, hidden, and output..│
│                                                                │
│        [Open in Library]                                       │
└────────────────────────────────────────────────────────────────┘
```

**Relevance score display options:**

| Format | Example | Assessment |
|--------|---------|------------|
| Percentage | 94% | ✓ Intuitive, familiar |
| Decimal | 0.94 | Technical, less intuitive |
| Stars | ★★★★★ | Vague, not precise |
| Bar | ████░ | Takes space, hard to compare |
| Rank | #1 | Loses magnitude info |

**Decision**: Percentage with visual indicator (large number + subtle bar).

### Result Card Height Analysis

| Content | Height | Assessment |
|---------|--------|------------|
| Title + URL only | ~60px | No context, why did it match? |
| + Tags + 1 Q&A | ~140px | ✓ Shows relevance, scannable |
| + Multiple Q&A | ~200px+ | Too tall, fewer visible |
| Expandable | Variable | ✓ Compact default, expand for more |

**Decision**: ~140px default showing best Q&A match. Option to expand for all matches.

---

## 4. STUMBLE (Random Discovery)

### Purpose
Resurface forgotten bookmarks through randomness. Shows 10 random items with one Q&A each.

### Design: Sidebar + Random Results

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Bookmarks         [Library] [Search] [Stumble] [Settings]                  │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  STUMBLE   │  🎲 STUMBLE                                                    │
│            │  Rediscover your saved knowledge                               │
│  ────────  │                                                                │
│            │  ┌──────────────────────┐                                      │
│  Showing   │  │  ↻  Shuffle Again    │                                      │
│  10 random │  └──────────────────────┘                                      │
│  bookmarks │                                                                │
│            │  ───────────────────────────────────────────────────────────   │
│  ────────  │                                                                │
│            │  ┌────────────────────────────────────────────────────────┐   │
│  FILTER    │  │  Understanding WebSockets                              │   │
│            │  │  developer.mozilla.org              Saved 3 months ago │   │
│  Tags:     │  │  #reference #webdev                                    │   │
│  [All    ▼]│  │                                                        │   │
│            │  │  Q: When should you use WebSockets vs HTTP polling?    │   │
│  ────────  │  │  A: WebSockets are ideal for real-time bidirectional   │   │
│            │  │     communication like chat apps and live feeds...     │   │
│  TIP       │  │                                                        │   │
│            │  │  [Open in Library]  [Add tag]                          │   │
│  Stumble   │  └────────────────────────────────────────────────────────┘   │
│  helps you │                                                                │
│  rediscover│  ┌────────────────────────────────────────────────────────┐   │
│  old gems  │  │  The Art of Readable Code                              │   │
│  in your   │  │  oreilly.com                        Saved 6 months ago │   │
│  knowledge │  │  #reading #programming                                 │   │
│  base.     │  │                                                        │   │
│            │  │  Q: What is the "newspaper" code organization?         │   │
│            │  │  A: Like a newspaper, code should have important info  │   │
│            │  │     at the top, with details following below...        │   │
│            │  │                                                        │   │
│            │  │  [Open in Library]  [Add tag]                          │   │
│            │  └────────────────────────────────────────────────────────┘   │
│            │                                                                │
│   200px    │                        flex: 1                                 │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### Layout Analysis

**Why same structure as Search?**

| Benefit | Explanation |
|---------|-------------|
| Visual consistency | User knows where to look |
| Sidebar reuse | Filter by tag works the same way |
| Mental model | "Search finds specific, Stumble finds random" |
| Code reuse | Result cards are identical components |

### Sidebar Content

```
STUMBLE             ← Section label

Showing 10 random   ← Explain what's happening
bookmarks

─────────────────

FILTER

Tags:               ← Limit randomness to specific tag
[All tags      ▼]

─────────────────

TIP                 ← Contextual help

Stumble helps you
rediscover old
gems in your
knowledge base.
Press ↻ to shuffle.
```

**Why include tips in sidebar?**

| Approach | Pros | Cons |
|----------|------|------|
| Show tips | ✓ Explains feature | Takes space |
| | ✓ Fills sidebar space | |
| No tips | Cleaner | Feature may be unclear |

**Decision**: Include brief contextual tips. Can be dismissed.

### Random Selection Algorithm

```typescript
async function getStumbleBookmarks(
  tagFilter?: string,
  count: number = 10
): Promise<StumbleItem[]> {
  // Get all complete bookmarks
  let bookmarks = await db.bookmarks
    .where('status').equals('complete')
    .toArray();

  // Apply tag filter if specified
  if (tagFilter) {
    const taggedIds = await db.bookmarkTags
      .where('tagId').equals(tagFilter)
      .primaryKeys();
    bookmarks = bookmarks.filter(b =>
      taggedIds.some(t => t[0] === b.id)
    );
  }

  // Fisher-Yates shuffle for true randomness
  for (let i = bookmarks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [bookmarks[i], bookmarks[j]] = [bookmarks[j], bookmarks[i]];
  }

  // Take first N
  const selected = bookmarks.slice(0, count);

  // Get one random Q&A for each
  return Promise.all(selected.map(async (bookmark) => {
    const qaPairs = await db.questionAnswers
      .where('bookmarkId').equals(bookmark.id)
      .toArray();

    const randomIndex = Math.floor(Math.random() * qaPairs.length);
    return {
      bookmark,
      qa: qaPairs[randomIndex]
    };
  }));
}
```

### Weighting Considerations

**Should older bookmarks appear more often?**

| Approach | Pros | Cons |
|----------|------|------|
| Pure random | Simple, fair | Recent items resurface too |
| Weight by age | ✓ Older items surface more | Complex, harder to explain |
| Exclude recent (7d) | Simple rule, clear behavior | Arbitrary cutoff |

**Decision**: Start with pure random. Future option: "Exclude recently viewed".

---

## 5. SETTINGS (Configuration)

### Purpose
Configure API, appearance, manage data. Should feel like part of the app, not a separate admin area.

### Design: Sidebar + Sections (Unified with other pages)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  Bookmarks         [Library] [Search] [Stumble] [Settings]                  │
├────────────┬────────────────────────────────────────────────────────────────┤
│            │                                                                │
│  SETTINGS  │  APPEARANCE                                                    │
│            │  ─────────────────────────────────────────────────────────     │
│  ● Appear. │                                                                │
│  ○ API     │  Theme                                                         │
│  ○ Data    │                                                                │
│  ○ About   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌──────────┐ ┌────────┐     │
│            │  │        │ │        │ │        │ │          │ │        │     │
│            │  │  Auto  │ │ Light  │ │  Dark  │ │ Terminal │ │ Tufte  │     │
│            │  │        │ │        │ │        │ │          │ │        │     │
│            │  └────────┘ └────────┘ └────────┘ └──────────┘ └────────┘     │
│            │      ○          ○          ●            ○           ○          │
│            │                       (selected)                               │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│            │                                                                │
│   200px    │                        flex: 1                                 │
└────────────┴────────────────────────────────────────────────────────────────┘
```

### Why Sidebar Navigation for Settings?

| Approach | Pros | Cons |
|----------|------|------|
| Sidebar nav | ✓ Consistent with other pages | More clicks to switch sections |
| | ✓ Clear current location | |
| | ✓ All sections visible | |
| Vertical scroll | Simpler, everything visible | Long page, hard to navigate |
| Tabs | Compact | Limited to few sections |
| Accordion | Compact | Only one section visible |

**Decision**: Sidebar navigation matches Library/Search/Stumble pattern.

### Settings Sections

```
SETTINGS            ← Section label

● Appearance        ← Currently selected
○ API Configuration
○ Data Management
○ About
```

### Section: Appearance

```
APPEARANCE
───────────────────────────────────────────────────────────────

Theme

Choose how Bookmarks looks. Auto follows your system settings.

┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│              │ │   ┌─────┐    │ │   ┌─────┐    │
│   ◐ Auto     │ │   │ Aa  │    │ │   │ Aa  │    │
│              │ │   └─────┘    │ │   └─────┘    │
│  (follows    │ │    Light     │ │    Dark      │
│   system)    │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘
       ○                ○                ●

┌──────────────┐ ┌──────────────┐
│   ┌─────┐    │ │   ┌─────┐    │
│   │ >_  │    │ │   │ Aa  │    │
│   └─────┘    │ │   └─────┘    │
│   Terminal   │ │    Tufte     │
│              │ │              │
└──────────────┘ └──────────────┘
       ○                ○
```

**Theme selector layout analysis:**

| Layout | Pros | Cons |
|--------|------|------|
| Horizontal row | Compact, quick scan | May wrap on narrow screens |
| Grid (3+2 or 2+3) | ✓ Balanced, responsive | Slightly more vertical space |
| Vertical list | Clear, no wrapping | Wastes horizontal space |
| Dropdown | Minimal space | Hides options, extra click |

**Decision**: Grid layout (3 columns, wraps to 2 on narrow). Each option shows a preview.

### Section: API Configuration

```
API CONFIGURATION
───────────────────────────────────────────────────────────────

Configure your AI provider for Q&A generation and semantic search.

API Base URL
┌─────────────────────────────────────────────────────────────┐
│ https://api.openai.com/v1                                   │
└─────────────────────────────────────────────────────────────┘
OpenAI-compatible endpoint. For local models, use your local URL.

API Key
┌─────────────────────────────────────────────────────────────┐
│ sk-••••••••••••••••••••••••••••••••                         │
└─────────────────────────────────────────────────────────────┘
Your API key is stored locally and never shared.

        ┌─────────────────────┐    ┌─────────────────────┐
        │    Chat Model       │    │   Embedding Model   │
        ├─────────────────────┤    ├─────────────────────┤
        │ gpt-4o-mini         │    │text-embedding-3-small│
        └─────────────────────┘    └─────────────────────┘
        For Q&A generation          For semantic search

┌─────────────────┐  ┌───────────────────┐
│  Save Settings  │  │  Test Connection  │
└─────────────────┘  └───────────────────┘
```

**Form layout analysis:**

| Layout | Pros | Cons |
|--------|------|------|
| Single column | Simple, clear flow | Wastes horizontal space |
| Two columns | ✓ Efficient for related fields | May feel cramped |
| Mixed | ✓ Full-width for long inputs, 2-col for short | Best balance |

**Decision**: Full-width for URL and API key (long values). Two-column for models (short values, related).

### Section: Data Management

```
DATA MANAGEMENT
───────────────────────────────────────────────────────────────

Import & Export

Back up your bookmarks or transfer between browsers.

┌──────────────────────────────┐  ┌──────────────────────────────┐
│                              │  │                              │
│      📁                      │  │      🔗                      │
│                              │  │                              │
│   Import from File           │  │   Import URLs                │
│                              │  │                              │
│   Upload a previously        │  │   Paste a list of URLs       │
│   exported JSON file         │  │   to import in bulk          │
│                              │  │                              │
└──────────────────────────────┘  └──────────────────────────────┘

┌──────────────────────────────┐
│   Export All Bookmarks       │   Download as JSON file
└──────────────────────────────┘

───────────────────────────────────────────────────────────────

Processing Queue

2 items currently processing

┌─────────────────────────────────────────────────────────────┐
│ Article Title                                      67% ████░│
│ Generating Q&A pairs...                                     │
├─────────────────────────────────────────────────────────────┤
│ Another Article                                    Pending  │
│ Waiting in queue (position 2)                               │
└─────────────────────────────────────────────────────────────┘
```

**Import options layout analysis:**

| Layout | Pros | Cons |
|--------|------|------|
| Side by side cards | ✓ Easy comparison | May wrap on narrow |
| Vertical stack | Clear separation | Takes more vertical space |
| Tabs | Compact | Hides one option |

**Decision**: Side-by-side cards with clear icons and descriptions.

### Section: About

```
ABOUT
───────────────────────────────────────────────────────────────

Bookmarks by Localforge
Version 3.4.0

───────────────────────────────────────────────────────────────

Privacy

Your bookmarks are stored entirely in your browser's local storage.
Only extracted text content is sent to your configured API for
Q&A generation and embedding creation. We never see your data.

───────────────────────────────────────────────────────────────

Resources

┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Documentation  │  │  Report Issue   │  │  Privacy Policy │
└─────────────────┘  └─────────────────┘  └─────────────────┘
```

---

## Data Model

### Tags Table (New)

```typescript
interface Tag {
  id: string;          // UUID
  name: string;        // Unique, lowercase, no spaces
  color?: string;      // Optional hex color (e.g., "#ef4444")
  createdAt: Date;
  updatedAt: Date;
}
```

**Tag name constraints:**

| Constraint | Rationale |
|------------|-----------|
| Unique | Prevent duplicates |
| Lowercase | Consistent matching |
| No spaces | Use hyphens instead |
| Max 32 chars | Prevent abuse |
| No special chars | Clean display |

### BookmarkTags Table (New)

```typescript
interface BookmarkTag {
  bookmarkId: string;  // FK → Bookmarks.id
  tagId: string;       // FK → Tags.id
  addedAt: Date;
}
```

### Schema Migration

```typescript
// db/schema.ts
db.version(3).stores({
  // Existing tables unchanged
  bookmarks: 'id, url, status, createdAt, updatedAt',
  markdown: 'id, bookmarkId, createdAt, updatedAt',
  questionAnswers: 'id, bookmarkId, createdAt, updatedAt',
  jobs: 'id, bookmarkId, parentJobId, status, type, [parentJobId+status], [bookmarkId+type]',
  settings: 'key, createdAt, updatedAt',

  // New tables
  tags: 'id, &name, createdAt, updatedAt',
  bookmarkTags: '[bookmarkId+tagId], bookmarkId, tagId, addedAt'
});
```

---

## Responsive Breakpoints

### Breakpoint Definitions

| Name | Width | Typical Device |
|------|-------|----------------|
| Desktop | ≥1200px | Large monitors |
| Laptop | 900-1199px | Laptops, small monitors |
| Tablet | 600-899px | Tablets, large phones landscape |
| Mobile | <600px | Phones |

### Layout Adaptations

**Library:**

| Breakpoint | Layout |
|------------|--------|
| Desktop | 3 columns: sidebar (200) + list (350) + detail (flex) |
| Laptop | 3 columns: sidebar (180) + list (300) + detail (flex) |
| Tablet | 2 columns: sidebar as drawer + list (flex), detail as overlay |
| Mobile | 1 column: sidebar as dropdown, list full, detail full screen |

**Search/Stumble:**

| Breakpoint | Layout |
|------------|--------|
| Desktop | 2 columns: sidebar (200) + results (flex) |
| Laptop | 2 columns: sidebar (180) + results (flex) |
| Tablet | 1 column: filters as top bar, results full width |
| Mobile | 1 column: filters as dropdown, results stacked |

**Settings:**

| Breakpoint | Layout |
|------------|--------|
| Desktop | 2 columns: sidebar (200) + content (flex, max-width 680) |
| Laptop | 2 columns: sidebar (180) + content (flex) |
| Tablet | 1 column: nav as tabs at top, content below |
| Mobile | 1 column: nav as dropdown, content full width |

---

## Keyboard Navigation

### Global Shortcuts

| Key | Action |
|-----|--------|
| `1` | Go to Library |
| `2` | Go to Search |
| `3` | Go to Stumble |
| `4` | Go to Settings |
| `/` | Focus search input (on Search page) |
| `Escape` | Close modal/dropdown/panel |

### Library Shortcuts

| Key | Action |
|-----|--------|
| `j` / `↓` | Next bookmark in list |
| `k` / `↑` | Previous bookmark in list |
| `Enter` | Select highlighted bookmark |
| `t` | Open tag dropdown (when bookmark selected) |
| `Backspace` | Close detail panel |

### Search/Stumble Shortcuts

| Key | Action |
|-----|--------|
| `j` / `↓` | Next result |
| `k` / `↑` | Previous result |
| `Enter` | Open in Library |
| `r` | Shuffle (Stumble only) |

---

## Implementation Phases

### Phase 1: Foundation (Tags + Schema)
- [ ] Add Tags and BookmarkTags tables (schema v3)
- [ ] Create tag CRUD operations in `lib/tags.ts`
- [ ] Add tag display to existing bookmark cards
- [ ] Tag management in detail panel

### Phase 2: Library Redesign
- [ ] Implement sidebar with tag filtering
- [ ] Add "Untagged" smart view
- [ ] Three-column layout
- [ ] Responsive breakpoints

### Phase 3: Search Page
- [ ] Create dedicated `search.html`
- [ ] Implement sidebar with filters
- [ ] Search history storage
- [ ] Enhanced result cards

### Phase 4: Stumble Feature
- [ ] Create `stumble.html`
- [ ] Random selection algorithm
- [ ] Shuffle functionality
- [ ] Tag filtering

### Phase 5: Settings Overhaul
- [ ] Sidebar navigation
- [ ] Section-based content
- [ ] Match visual hierarchy with other pages

### Phase 6: Polish
- [ ] Unified header component
- [ ] Keyboard navigation
- [ ] Animations and transitions
- [ ] Mobile responsive testing

---

## Open Questions

| Question | Options | Recommendation |
|----------|---------|----------------|
| Tag ordering? | Alphabetical, by count, manual | Alphabetical (simple, predictable) |
| Max tags per bookmark? | Unlimited, 5, 10 | Unlimited (user's choice) |
| Tag colors required? | Yes, No, Optional | Optional (nice-to-have) |
| Search history length? | 5, 10, 20 | 5 (minimal, useful) |
| Stumble weighting? | Pure random, weight old | Pure random (simple first) |

---

*Document v3.0 - December 2024*
*Deep analysis of layout decisions, pros/cons, space utilization*

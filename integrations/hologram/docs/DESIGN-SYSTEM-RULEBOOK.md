# HOLOGRAM DESIGN SYSTEM RULEBOOK v1.6
> **STRICT IMPLEMENTATION GUIDE FOR CURSOR & OPUS**
> Last Updated: December 26, 2025 (Session 85+)
> Based on: hologram-moodboard-v5.5, v5.6, v6.0, v6.1, v6.2.2, v6.3, v6.4
> Logo: G. Layered Depths (V7.3) | Splash: D2 Quick Snap Lock

---

## 🎯 CRITICAL RULES - NEVER VIOLATE

1. **NO DEVIATIONS** - Follow this rulebook exactly. No creative interpretations.
2. **HIERARCHY IS LAW** - Respect the 9-shade void hierarchy and 5-level text hierarchy
3. **SPACING IS SACRED** - Use only the defined 4px grid system
4. **FONTS ARE FIXED** - JetBrains Mono only (bundled), SVG wordmark for branding
5. **ANIMATIONS ARE SUBTLE** - Smooth, not flashy. Breathing, not pulsing.

---

## 📐 FOUNDATION

### COLOR SYSTEM

#### Void Hierarchy (9 Precise Shades) - USE IN ORDER
```css
--void-pure:    #000000  /* Absolute black - code blocks, terminal */
--void-abyss:   #040408  /* Vignette overlay */
--void-deep:    #08080e  /* Input backgrounds, deep wells */
--void-base:    #0c0c14  /* Page background - NEVER change */
--void-mid:     #12121c  /* Card backgrounds, elevated surfaces */
--void-up:      #181824  /* Raised elements, hover states */
--void-surface: #1e1e2a  /* Surface overlays */
--void-hover:   #262634  /* Hover state backgrounds */
--void-active:  #2e2e3e  /* Active/pressed states */
```

#### Accent Colors - EXACT VALUES
```css
/* Primary - Cyan */
--cyan-50:  #ecfeff
--cyan-100: #cffafe
--cyan-200: #a5f3fc
--cyan-300: #67e8f9  /* Logo color */
--cyan-400: #22d3ee  /* Primary interactions */
--cyan-500: #06b6d4  /* Primary buttons */
--cyan-600: #0891b2  /* Pressed states */

/* Secondary - Violet */
--violet-200: #ddd6fe
--violet-300: #c4b5fd
--violet-400: #a78bfa  /* Secondary accent */
--violet-500: #8b5cf6
--violet-600: #7c3aed

/* Tertiary - Emerald */
--emerald-300: #6ee7b7
--emerald-400: #34d399  /* Success states */
--emerald-500: #10b981

/* Quaternary - Pink (Address/Wallet accent) */
--pink-400: #ec4899  /* Address results, wallet indicators */

/* Status Colors - NEVER MIX */
--status-ok:   #34d399  /* Success ONLY */
--status-warn: #fbbf24  /* Warning ONLY */
--status-err:  #f87171  /* Error ONLY */
```

#### Gradients - EXACT DEFINITIONS
```css
--grad-primary: linear-gradient(135deg, #22d3ee 0%, #a78bfa 100%);
--grad-vertical: linear-gradient(180deg, #22d3ee 0%, #8b5cf6 100%);
--grad-tri: linear-gradient(135deg, #22d3ee 0%, #a78bfa 50%, #34d399 100%);
--grad-shimmer: linear-gradient(90deg, #0891b2, #a78bfa, #22d3ee, #a78bfa, #0891b2);
```

### TYPOGRAPHY

#### Font Family - MONO-ONLY SYSTEM (Privacy-First)
```css
--font-mono: 'JetBrains Mono', ui-monospace, 'SF Mono', 'Cascadia Code', 'Consolas', monospace;
```

**Key Points:**
- **Single bundled font** (JetBrains Mono) - no external dependencies
- **SVG wordmark** for "HOLOGRAM" branding - zero font loading issues
- **System fallbacks** for offline capability
- **No Google Fonts** - privacy-first approach

#### HOLOGRAM Wordmark
Use the `<Wordmark>` SVG component for the app name. Sizes: `xs`, `sm`, `md`, `lg`
```svelte
<Wordmark size="md" glow={true} />
```

#### Text Sizes - EXACT PIXELS
```css
/* Headers - Use weight, spacing, and uppercase for hierarchy */
.text-display  { font-size: 32px; font-weight: 700; letter-spacing: 0.15em; text-transform: uppercase; }
.text-h1       { font-size: 18px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; }
.text-h2       { font-size: 16px; font-weight: 600; }
.text-h3       { font-size: 14px; font-weight: 600; }

/* Body */
.text-body     { font-size: 13px; }  /* 0.8125rem - Default text */
.text-sm       { font-size: 13px; }  /* Small text */
.text-xs       { font-size: 12px; }  /* Extra small */

/* Labels - ALWAYS UPPERCASE */
.text-label    { font-size: 10px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.2em; }
.text-label-md { font-size: 11px; font-weight: 500; text-transform: uppercase; letter-spacing: 0.15em; }
```

#### Content Section Headers - UNIFIED PATTERN (v6.1)
For section headers within page content areas (e.g., "Install TELA DOC", "Mining Control Panel"):
```html
<div class="content-section-title">Section Title Here</div>
<p class="content-section-desc">Brief description of what this section does.</p>
```
```css
.content-section-title {
  font-family: var(--font-mono);
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--text-1);
  margin: 0 0 var(--s-2) 0;
}

.content-section-desc {
  font-family: var(--font-mono);
  font-size: 13px;
  font-style: italic;
  color: var(--text-3);
  margin: 0 0 var(--s-5) 0;
}
```

**Key Points:**
- ⚠️ **ALWAYS** use `.content-section-title` for all page section headers
- ⚠️ **NEVER** create component-scoped versions (e.g., `.section-title`)
- Titles are always uppercase via CSS `text-transform`
- Wide letter-spacing (0.12em) for the HOLOGRAM aesthetic

#### Text Color Hierarchy - 5 LEVELS ONLY
```css
--text-1: #f8f8fc  /* Primary text - headers, important */
--text-2: #a8a8b8  /* Body text - readable content */
--text-3: #707088  /* Secondary - descriptions */
--text-4: #505068  /* Muted - hints, timestamps */
--text-5: #404058  /* Dimmed - least important */
```

### SPACING SYSTEM - 4px BASE GRID

**RULE: Every spacing value MUST be a multiple of 4px**

```css
--s-1:  4px
--s-2:  8px
--s-3:  12px
--s-4:  16px
--s-5:  20px
--s-6:  24px
--s-8:  32px
--s-10: 40px
--s-12: 48px
--s-16: 64px
```

### BORDER RADII - EXACT VALUES

```css
--r-xs:   3px    /* Badges, small elements */
--r-sm:   5px    /* Buttons, inputs */
--r-md:   8px    /* Cards, modals */
--r-lg:   12px   /* Large cards */
--r-xl:   16px   /* Containers */
--r-2xl:  24px   /* Hero sections */
--r-full: 9999px /* Pills, circles */
```

### BORDERS - OPACITY LEVELS

```css
--border-dim:     rgba(255, 255, 255, 0.03)
--border-subtle:  rgba(255, 255, 255, 0.06)
--border-default: rgba(255, 255, 255, 0.09)
--border-strong:  rgba(255, 255, 255, 0.12)
--border-accent:  rgba(34, 211, 238, 0.4)
```

### MOTION - SMOOTH ONLY

```css
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);       /* Standard easing */
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1); /* Bounce effect */
--dur-fast: 120ms;
--dur-med: 200ms;
--dur-slow: 350ms;
```

#### Standard Transition Patterns
```css
/* Quick interactions (hover, focus) */
transition: all 150ms ease;

/* State changes (expanding, collapsing) */
transition: all 200ms ease-out;

/* Background/color only */
transition: background 150ms ease, color 150ms ease;
```

---

## 🎨 BACKGROUND EFFECTS

### Dot Grid Pattern - MANDATORY
```css
background-image: radial-gradient(circle at center, rgba(34, 211, 238, 0.065) 1px, transparent 1px);
background-size: 24px 24px;
```
**RULE:** Opacity MUST be 0.065 - not darker, not lighter

### Vignette Overlay
```css
background: radial-gradient(ellipse at center, transparent 0%, var(--void-abyss) 100%);
opacity: 0.5;
```

### Noise Texture
```css
opacity: 0.012; /* EXACT - provides subtle texture */
```

---

## 🧩 COMPONENTS

### LOGO

#### G. Layered Depths Colorway (V7.3 Final)

The HOLOGRAM logo uses a solid-fill glyphic design with tonal depth progression:

| Layer | Color | CSS Variable | Purpose |
|-------|-------|--------------|---------|
| **Frame** | `#67e8f9` | `--cyan-300` | Light cyan outer glow boundary (brightest) |
| **Void** | `#0c1218` | N/A | Dark depth layer creating separation |
| **Body** | `#22d3ee` | `--cyan-400` | Primary cyan H letterform |
| **Arrows** | `#0d4a55` | N/A | Teal indent (directional flow cutouts) |

**Logo Files:**
- `frontend/src/assets/hex_hologram_logo.svg` - Main logo (24px+)
- `frontend/src/assets/hex_hologram_logo_icon.svg` - Icon version (<24px)
- `build/appicon.svg` - App icon with dark rounded background

**Other Asset Files:**
- `frontend/src/assets/dero-icon-fallback.svg` - DERO logo (white) for app icon fallbacks

#### Splash Animation (D2 Quick Snap Lock)
- Duration: 5 seconds
- First half: Arrows flicker independently (top @10%, bottom @30%)
- Second half: Quick rise → 135% brightness flash → INSTANT LOCK
- Chromatic aberration: Red/blue ghost layers
- Glow effect: Use `overflow: visible` on logo wrapper to prevent clipping

#### Wordmark (Text Branding)
Use the `<Wordmark>` SVG component for the app name. Sizes: `xs`, `sm`, `md`, `lg`
```svelte
<Wordmark size="md" glow={true} />
```

### BADGES

#### Structure
```css
padding: 2px 10px;
font-size: 9px;
font-weight: 500;
text-transform: uppercase;
letter-spacing: 0.1em;
border-radius: var(--r-xs); /* 3px */
border: 1px solid [color];
```

#### Badge Types
- **badge-cyan**: Border `--cyan-500`, text `--cyan-400`
- **badge-violet**: Border `--violet-500`, text `--violet-400`
- **badge-emerald**: Border `--emerald-500`, text `--emerald-400`
- **badge-live**: Has pulsing dot (5x5px), green background alpha 0.08

### STATUS DOTS

#### Size & Structure
```css
width: 7px;
height: 7px;
border-radius: 50%;
box-shadow: 0 0 8px [color];
```

#### Dot Types
- **dot-cyan**: Static, cyan glow
- **dot-ok**: Static, green glow
- **dot-warn**: Pulsing animation, yellow
- **dot-err**: Static, red glow

### CARDS

#### Base Card
```css
background: var(--void-mid);
border: 1px solid var(--border-default);
border-radius: var(--r-lg); /* 12px */
```
- Hover: Border to `--border-strong`, translateY(-2px), shadow

#### Card Variants
1. **card-top**: 3px gradient bar at top edge
2. **card-shimmer**: Animated gradient border, 4s linear infinite
3. **card-glow**: Cyan border with glow shadow
4. **card-gradient**: Static gradient border, 0.7 opacity

#### Utilitarian Card Headers (Explorer Style) 
**PREFERRED FOR DATA-HEAVY INTERFACES**
```css
.card-header-util {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 0 16px 0;  /* No top/side padding, clean */
  margin-bottom: 24px;
  border-bottom: 1px solid var(--border-dim);
}
```

##### Header Structure:
```html
<div class="card-header-util">
  <div class="card-header-left">
    <span class="card-header-icon">◎</span>
    <span class="card-header-title">NETWORK STATS</span>
  </div>
  <div class="card-header-right">
    <span class="card-header-meta">02:05:39 AM</span>
    <span class="badge badge-live">● LIVE</span>
  </div>
</div>
```

##### Header Components:
- **Icon**: 16px, `--text-3`, **FILLED** geometric shapes only (◎ ◉ ⬢ ♥ ☰ ⚡)
  - ⚠️ **NEVER** use hollow symbols (□ ⬡ ◇ ○ ♡) - they don't accept CSS color
  - These symbols inherit `color: var(--cyan-400)` from `.cmd-panel-icon`
- **Title**: Display font, 14px, uppercase, 0.1em letter-spacing, `--text-2`
- **Meta**: Mono font, 11px, `--text-4`
- **Live Badge**: Cyan dot + text, minimal padding
- **No backgrounds or boxes** - clean and flat
- **Minimal padding** - tight and efficient
- **Bottom border only** - creates visual separation

### BUTTONS

#### Sizes & Padding
- **Default**: `padding: 8px 16px; font-size: 12px;`
- **Small**: `padding: 4px 12px; font-size: 11px;`
- **Large**: `padding: 12px 24px; font-size: 14px;`
- **Icon**: `padding: 8px; width: 32px; height: 32px;`

#### Button Types
1. **btn-primary**
   - Background: `--cyan-500`
   - Color: `--void-pure`
   - Hover: brightness(1.1), translateY(-1px), cyan glow

2. **btn-secondary**
   - Background: transparent
   - Border: `--cyan-500`
   - Color: `--cyan-400`
   - Hover: rgba(34, 211, 238, 0.1) background

3. **btn-ghost**
   - Background: transparent
   - Color: `--text-2`
   - Hover: `--void-hover` background, `--text-1` color

4. **btn-danger**
   - Background: rgba(248, 113, 113, 0.1)
   - Border: rgba(248, 113, 113, 0.3)
   - Color: `--status-err`

5. **btn-success**
   - Background: rgba(52, 211, 153, 0.1)
   - Border: rgba(52, 211, 153, 0.3)
   - Color: `--status-ok`

### FORM ELEMENTS

#### Input Fields
```css
padding: 12px 16px;
font-size: 13px;
background: var(--void-deep);
border: 1px solid var(--border-default);
border-radius: var(--r-md); /* 8px */
```
- Focus: Border `--cyan-500`, shadow 3px cyan 0.15 alpha
- Error: Border `--status-err`
- Disabled: 0.5 opacity, `--void-mid` background

#### Select/Dropdown - CRITICAL PATTERN

**⚠️ ALL select elements MUST use the global `.select` class from hologram.css or replicate this exact pattern:**

```css
/* Global class available: .select */
.select {
  width: 100%;
  padding: var(--s-3) var(--s-4);
  padding-right: 36px;              /* Room for dropdown arrow */
  font-family: var(--font-mono);
  font-size: 13px;
  color: var(--text-1);
  background: var(--void-deep);
  /* Custom dropdown arrow - MUST use this SVG */
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%23707088' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  border: 1px solid var(--border-default);
  border-radius: var(--r-md);
  appearance: none;                 /* REQUIRED - removes native styling */
  -webkit-appearance: none;
  -moz-appearance: none;
  cursor: pointer;
  transition: all var(--dur-fast);
}

.select:hover { border-color: var(--border-strong); }
.select:focus { 
  outline: none; 
  border-color: var(--cyan-500); 
  box-shadow: 0 0 0 3px rgba(34, 211, 238, 0.15); 
}
.select:disabled { opacity: 0.5; cursor: not-allowed; background: var(--void-mid); }

/* Style the options (limited browser support) */
.select option {
  background: var(--void-deep);
  color: var(--text-1);
}
```

**Key Requirements:**
1. **`appearance: none`** - Removes OS-native dropdown styling (light gradients, etc.)
2. **Custom SVG arrow** - Grey chevron (#707088) positioned right 12px center
3. **`padding-right: 36px`** - Extra space for the custom arrow
4. **Dark background** - `var(--void-deep)`, NEVER use light/gradient backgrounds
5. **Consistent focus state** - Cyan border + 3px glow shadow

**Usage in Components:**
```html
<!-- Preferred: Use global class -->
<select class="select" bind:value={selectedOption}>
  <option value="a">Option A</option>
  <option value="b">Option B</option>
</select>

<!-- If using scoped class, replicate the FULL pattern above -->
```

**❌ FORBIDDEN:**
- Native browser dropdown styling (light gradients, raised borders)
- Missing `appearance: none`
- Light backgrounds on dropdowns
- Custom arrow colors other than `#707088`

#### Toggle Switch
```css
width: 44px;
height: 24px;
background: var(--void-hover);
```
- Knob: 20x20px, 2px from edge
- Checked: Background `--cyan-500`, knob right

#### Checkbox
```css
width: 18px;
height: 18px;
border-radius: 3px;
background: var(--void-deep);
border: 1px solid var(--border-default);
```
- Checked: `--cyan-500` background with stroke-based checkmark SVG

**Checkmark SVG (CRITICAL):**
```css
/* MUST use stroke, NOT fill for the checkmark path */
.checkbox:checked {
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' d='M2.5 6L5 8.5L9.5 3.5'/%3E%3C/svg%3E");
}
```

**Key requirements:**
- `fill='none'` - Path has no fill
- `stroke='%23000'` - Black stroke color
- `stroke-width='2'` - Visible thickness
- `stroke-linecap='round'` + `stroke-linejoin='round'` - Smooth corners
- Path `M2.5 6L5 8.5L9.5 3.5` - Proportional checkmark shape

**❌ FORBIDDEN:** Using `fill` on line paths (renders invisible)

#### Slider
```css
height: 6px;
background: var(--void-hover);
```
- Thumb: 18x18px, `--cyan-400`, glow shadow

### NAVIGATION

#### Sidebar Width
**LOCKED**: 200px standard, 220px for unified framework

#### Nav Items
```css
padding: 12px 16px;
font-size: 13px;
border-radius: 8px;
```
- Hover: `--void-hover` background
- Active: `--cyan-400` text, rgba(34, 211, 238, 0.08) background
- Icon: 14px size, 18px container width

#### Tabs
```css
.tabs {
  gap: 2px;
  padding: 2px;
  background: var(--void-up);
  border-radius: 8px;
}
.tab {
  padding: 8px 16px;
  font-size: 11px;
  border-radius: 5px;
}
```

### DATA DISPLAY

#### Network Stats Grid
**STRUCTURE**: 3x2 equal cells
```css
.cmd-stat-cell {
  padding: 16px 12px;
  background: var(--void-deep);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  text-align: center;
}
```
- Label: 9px, uppercase, `--text-4`
- Value: 20px, font-mono 700, `--cyan-400`
- Delta: 10px, `--text-4` or `--emerald-400` if positive

#### Progress Bars
```css
height: 3px;
background: var(--void-deep);
border-radius: 9999px;
```
- Fill: Gradient primary

#### Ring Progress
- Size: 140x140px
- Stroke: 8px width
- Animation: strokeDashoffset from 377 to 94

### SEARCH BAR

#### OmniSearch Structure
```css
padding: 12px 16px;
background: var(--void-deep);
border: 1px solid var(--border-default);
border-radius: 12px;
```
- Icon: 16px, `--text-4`
- Input: 14px, transparent background
- Keyboard hint: 10px size, `--void-mid` background
- Button: `--cyan-500` background, 12px text

### MODALS & OVERLAYS

#### Inline Notifications (v6.1)

**Inline Notification (e.g., New Block notification):**

Prefer simple, clickable badge-style notifications for transient events:

```css
.new-block-notification {
  display: inline-flex;
  align-items: center;
  gap: var(--s-2);
  padding: var(--s-2) var(--s-3);
  background: rgba(34, 211, 238, 0.08);
  border: 1px solid rgba(34, 211, 238, 0.25);
  border-radius: var(--r-sm);
  cursor: pointer;
  transition: all 150ms ease;
  font-family: var(--font-mono);
  color: var(--cyan-400);
}
```

**Notification Structure:**
```html
<button class="new-block-notification" on:click={handleAction}>
  <Icon size={14} />
  <span class="notification-text">New Block #6,333,283</span>
  <span class="notification-action">View</span>
  <ChevronRight size={12} />
</button>
```

**Notification Components:**
- Icon: 14px, same color as container accent
- Text: 12px, font-mono, weight 600, `--text-1`
- Action label: 11px, uppercase, 0.08em letter-spacing, accent color
- Entire element is clickable (button element)
- Hover: Slightly brighter background + subtle glow

**Floating Toast (system notifications):**
```css
padding: var(--s-3) var(--s-4);
background: var(--void-mid);
border: 1px solid var(--border-default);
border-radius: var(--r-lg);
min-width: 280px;
max-width: 400px;
```
- Icon: 18px
- Title: 13px, 500 weight
- Message: 12px, `--text-3`

#### Modal Windows
```css
background: var(--void-mid);
border-radius: 16px;
max-width: 480px;
```
- Header: 20px padding, border-bottom
- Body: 20px padding, max 60vh
- Footer: 16px 20px padding, border-top

### COMMAND CENTER (Explorer)

#### Live Badge
```css
padding: 2px 6px;
background: rgba(34, 211, 238, 0.1);
border: 1px solid rgba(34, 211, 238, 0.3);
font-size: 9px;
letter-spacing: 0.1em;
```
- Dot: 6x6px, pulsing animation

#### Activity Feed
- Timeline dot: 8x8px
- Timeline line: 1px width, `--border-subtle`
- Item spacing: 8px padding vertical
- Timestamp: 10px mono font, `--text-4`

#### Block Browser
- Height column: Display font, 12px, `--cyan-400`
- TXs: Mono 11px, `--text-3`
- Age: Mono 11px, `--text-4`
- Hash: Mono 11px, `--text-4`, right-aligned

### PAGE LAYOUT FRAMEWORK

#### Unified Structure
```
┌─────────────────────────────────────────┐
│ Page Header (rectangular, no radius)      │
├──────────┬─────────────────────────────┤
│ Sidebar  │ Content Area                  │
│ (220px)  │ (flex: 1)                     │
└──────────┴─────────────────────────────┘
```

#### Page Header - UNIFORM STRUCTURE (v6.3 - Session 57)

**ALL pages MUST use the same header structure for visual consistency.**

**CSS Classes:**
```css
.page-header           /* Full-width container */
.page-header-inner     /* Centered content (max-width: 1400px) */
.page-header-left      /* Title + description group */
.page-header-title     /* Icon + title row */
.page-header-icon      /* Grey icon (color: var(--text-3)) */
.page-header-desc      /* Italic description text */
.page-header-actions   /* Right-aligned action buttons */
```

**HTML Structure:**
```html
<div class="page-header">
  <div class="page-header-inner">
    <div class="page-header-left">
      <h1 class="page-header-title">
        <IconComponent size={18} class="page-header-icon" strokeWidth={1.5} />
        Page Title
      </h1>
      <p class="page-header-desc">Brief description of what this page does</p>
    </div>
    <div class="page-header-actions">
      <!-- Action buttons, toggles, badges -->
    </div>
  </div>
</div>
```

**Specifications:**
- Height: Flexible (typically 64px)
- Padding: 16px 24px (`var(--s-4) var(--s-6)`)
- Background: `--void-mid`
- Border-bottom: 1px `--border-dim`
- **NO border-radius** (rectangular)

**Icon Styling:**
- Size: 18px
- Color: `--text-3` (grey) - NOT white, NOT cyan
- Stroke width: 1.5
- Use direct Lucide imports: `import { IconName } from 'lucide-svelte';`
- ⚠️ Do NOT use the `Icons.svelte` wrapper for page header icons

**OmniSearch in Header (Explorer):**
- When using OmniSearch in `page-header-actions`, use `compact={true}` prop
- This ensures consistent header height across all pages

**Button Groups in Actions:**
- Wrap adjacent buttons in `<div class="network-toggle-group">` for proper CSS selector targeting
- This ensures `:first-child` and `:last-child` border-radius rules apply correctly

#### Sidebar Items
```css
padding: 8px 12px;
font-size: 13px;
border-radius: 5px;
gap: 12px;
```
- Section headers: 10px, uppercase, 0.12em spacing

#### Sidebar Status Indicators (v6.3 - Session 56)

**Layout:** Single-line format (label + value on same row)
```css
.unified-indicator {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  width: 100%;
  min-width: 100%;  /* Ensures full width */
}

.unified-indicator-content {
  display: flex;
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
  flex: 1 1 auto;
  gap: 6px;
}

.unified-indicator-label {
  font-size: 9px;           /* Compact to fit more */
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--text-4);
}

.unified-indicator-value {
  font-size: 10px;
  color: var(--text-2);
  text-align: right;
  /* NO text-overflow: ellipsis - show full value */
}

.dot-column {
  width: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
}
```

**Order (locked):** Node → Network → XSWD → Gnomon → EPOCH → Block

**Status Dot Colors:**
| Status | Color |
|--------|-------|
| ok/online | `--status-ok` (#34d399) |
| warn/syncing | `--status-warn` (#fbbf24) |
| err/offline | `--status-err` (#f87171) |

**⚠️ CSS Conflict Warning:**
Do NOT add global `.status-list` padding in hologram.css - this conflicts with Sidebar component styles. All sidebar padding is managed in `Sidebar.svelte`.

#### Collapsed Sidebar Overflow (v6.3 - Session 56)

**Critical:** Always use `overflow-x: hidden` on collapsed sidebar containers to prevent horizontal scrollbars.

```css
/* Base sidebar-menu needs explicit overflow-x: hidden */
.sidebar-menu {
  overflow-y: auto;
  overflow-x: hidden; /* Prevents horizontal scrollbar */
}

/* All collapsed containers must hide overflow */
.sidebar.collapsed {
  overflow: hidden;
}

.sidebar.collapsed .sidebar-menu {
  overflow-x: hidden;
}

.sidebar.collapsed .sidebar-status {
  overflow-x: hidden;
}
```

**Root Cause:** `overflow-y: auto` implicitly allows horizontal scrolling. When collapsed to 40px, any content overflow creates an unwanted scrollbar.

### SETTINGS PAGES

#### Settings Section Card
```css
background: var(--void-mid);
border: 1px solid var(--border-default);
border-radius: var(--r-lg);
margin-bottom: var(--s-6);
```

#### Settings Section Header
```css
padding: 16px 20px;
background: var(--void-up);
border-bottom: 1px solid var(--border-dim);
display: flex;
align-items: center;
gap: 12px;
```

#### Section Number Badge
```css
width: 32px;
height: 24px;
background: var(--cyan-500);
color: var(--void-pure);
font-size: 11px;
font-weight: 600;
border-radius: 5px;
display: flex;
align-items: center;
justify-content: center;
```

#### Section Title
```css
font-family: var(--font-display);
font-size: 14px;
font-weight: 600;
letter-spacing: 0.1em;
text-transform: uppercase;
color: var(--text-1);
```

#### Settings Row
```css
padding: 16px;
background: var(--void-deep);
border: 1px solid var(--border-subtle);
border-radius: 8px;
margin-bottom: 12px;
display: flex;
align-items: center;
justify-content: space-between;
```

#### Permission Cards (Connected Apps, etc.)
```css
padding: 20px;
background: var(--void-deep);
border: 1px solid var(--border-subtle);
border-radius: 8px;
text-align: center;
```

#### Network Selection Cards
```css
padding: 16px;
background: var(--void-deep);
border: 1px solid var(--border-subtle);
border-radius: 8px;
cursor: pointer;
transition: all 200ms ease-out;
```
- Active: Border `--cyan-500`, shadow `--glow-cyan-xs`
- Hover: Border `--border-strong`, background `--void-up`

#### Settings Components
- **Toggles**: Always 44x24px, right-aligned
- **Sliders**: 6px height, cyan-400 thumb
- **Badges**: Use only defined badge styles
- **Icons**: Lucide icons for navigation, filled Unicode symbols for panel headers (NO emojis)
- **Buttons**: Primary for main actions, secondary for cancel

---

## ⚡ ANIMATIONS

### Approved Animations Only

1. **logoBreath**: 6s, brightness 1.0-1.1
2. **shimmer**: 4s linear, gradient position
3. **pulse**: 2s ease, opacity 1.0-0.5
4. **livePulse**: 1.5s ease, opacity 1.0-0.3
5. **ringIn**: 1.5s ease-out, dashoffset animation
6. **spin**: 0.6s linear, rotation
7. **blink**: 1s step-end, cursor blink

**RULE**: No custom animations without approval

---

## ❌ FORBIDDEN PATTERNS

1. **NEVER** use gradients on text (except logo)
2. **NEVER** round corners on page headers or network banners
3. **NEVER** use colors outside the defined palette
4. **NEVER** mix font families (Display for headers, Mono for everything else)
5. **NEVER** use spacing values not in the grid
6. **NEVER** create shadows larger than defined
7. **NEVER** animate scale beyond 0.995-1.0 range
8. **NEVER** use opacity below 0.3 for important elements
9. **NEVER** nest cards deeper than 2 levels
10. **NEVER** use borders thicker than 1px (except focus states at 2px)
11. **NEVER** use emojis (colorful icons like 📊 🔌 💚) - Lucide icons or Unicode symbols instead
12. **NEVER** use hollow Unicode symbols for `.cmd-panel-icon` (□ ⬡ ◇ ○ ♡ △) - they render grey, not cyan
    - ✅ **Approved filled symbols**: ◎ ◉ ⬢ ♥ ☰ ⚡ ◆ ● ■ ▣
    - ❌ **Forbidden hollow symbols**: □ ⬡ ◇ ○ ♡ △ ▽
13. **NEVER** use `fill` on SVG line/polyline paths (checkmarks, arrows) - use `stroke` instead
    - ✅ **Correct**: `<path fill='none' stroke='#000' stroke-width='2' d='M2 6L5 9L10 3'/>`
    - ❌ **Wrong**: `<path fill='#000' d='M2 6L5 9L10 3'/>` (renders invisible)
14. **NEVER** leave `<img>` tags without error handling when loading external URLs
    - Always include `on:error` handler with fallback mechanism

---

## 🚫 CSS TOKEN USAGE

### No Fallback Values Needed

Design tokens are **guaranteed to exist** in hologram.css. Do NOT use fallback values:

```css
/* ❌ WRONG - unnecessary fallback */
padding: var(--s-4, 16px);
color: var(--text-1, #f8f8fc);
border-radius: var(--r-lg, 12px);

/* ✅ CORRECT - tokens are guaranteed */
padding: var(--s-4);
color: var(--text-1);
border-radius: var(--r-lg);
```

Fallbacks add noise and can mask issues if tokens are accidentally removed.

---

## ✅ IMPLEMENTATION CHECKLIST

When implementing any HOLOGRAM interface:

- [ ] Background has dot grid at 0.065 opacity
- [ ] Vignette overlay is present
- [ ] Noise texture at 0.012 opacity
- [ ] All text follows 5-level hierarchy
- [ ] All spacing is multiple of 4px
- [ ] Cards use void-mid background
- [ ] Inputs use void-deep background
- [ ] Primary actions use cyan-500
- [ ] Status colors are semantic only
- [ ] Animations are from approved list
- [ ] Font usage: Display for headers, Mono for body
- [ ] Uppercase labels have proper letter-spacing
- [ ] Focus states have 3px shadow spread
- [ ] Hover states use defined transitions
- [ ] Page headers are rectangular (no radius)

---

## 📋 COMPONENT PRIORITY

When building interfaces, implement in this order:

1. **Foundation**: Colors, typography, spacing
2. **Layout**: Page structure, sidebar, headers
3. **Navigation**: Sidebar items, tabs
4. **Form Elements**: Inputs, buttons, toggles
5. **Cards**: Basic cards, then variants
6. **Data Display**: Stats, progress, charts
7. **Feedback**: Toasts, modals, loading states
8. **Special**: Command center, activity feeds

---

## 📄 PAGE-SPECIFIC PATTERNS (v6.1)

### Naming Convention

All page-specific patterns use prefixes to avoid conflicts:

| Page | Prefix | Example |
|------|--------|---------|
| Settings | `.settings-*` | `.settings-page-header` |
| Browser | `.browser-*` | `.browser-app-card` |
| Wallet | `.wallet-*` | `.wallet-tx-item` |
| Studio | `.studio-*` | `.studio-dropzone` |
| Studio > My Content | `.mc-*` | `.mc-stats-row`, `.mc-content-item` |
| Explorer | `.cmd-*` | `.cmd-stat-cell` |
| Modals | `.modal-*` | `.modal-header` |
| Shared | `.holo-*` | `.holo-toggle` |
| Info Panels | `.info-panel-*` | `.info-panel-title` |

### Modal Patterns

All modals MUST use global `.modal-*` patterns from `hologram.css`:

```css
.modal-overlay      /* Full-screen backdrop with blur */
.modal-content      /* Centered modal container */
.modal-header       /* Title and close button row */
.modal-body         /* Scrollable content area */
.modal-footer       /* Action buttons row */
```

### Browser Patterns

Browser components MUST use global `.browser-*` patterns:

```css
.browser-tabs / .browser-tab / .browser-tab-active
.browser-url-bar / .browser-url-input / .browser-nav-btn
.browser-app-card / .browser-app-card-header / .browser-app-card-icon
.browser-favorites-section / .browser-favorites-grid
.browser-discover-header / .browser-filter-pills
.browser-console-panel / .browser-console-logs
```

#### App Icon Fallback Pattern (v6.4)

TELA app icons may fail to load (broken URL, missing asset, etc.). Use this pattern:

**Asset:** `frontend/src/assets/dero-icon-fallback.svg` (white DERO logo)

**Implementation:**
```svelte
<script>
  import deroIconFallback from '../assets/dero-icon-fallback.svg';
  
  let failedIcons = new Set();
  
  function handleIconError(iconUrl) {
    failedIcons.add(iconUrl);
    failedIcons = failedIcons; // Trigger reactivity
  }
  
  function shouldShowIcon(iconUrl) {
    return iconUrl && !failedIcons.has(iconUrl);
  }
</script>

{#if shouldShowIcon(app.icon)}
  <img src={app.icon} alt="" class="browser-app-icon-img" 
       on:error={() => handleIconError(app.icon)} />
{:else}
  <img src={deroIconFallback} alt="" class="browser-app-icon-fallback" />
{/if}
```

**Fallback CSS:**
```css
.browser-app-icon-fallback {
  width: 36px;      /* Slightly larger than normal (32px) */
  height: 36px;
  opacity: 0.7;     /* Muted to indicate placeholder */
}
```

**Key points:**
- Track failed URLs in a `Set` to prevent infinite error loops
- Use DERO logo (white on transparent) as universal fallback
- Fallback is slightly larger and reduced opacity
- Apply to both Browser.svelte and Discover.svelte

### Wallet Patterns

Wallet components MUST use global `.wallet-*` patterns:

```css
.wallet-balance-display / .wallet-balance-amount
.wallet-tx-list / .wallet-tx-item / .wallet-tx-status
.wallet-token-list / .wallet-token-row
.wallet-address
```

### Studio Patterns

Studio components MUST use global `.studio-*` patterns:

```css
.studio-mode-tabs / .studio-mode-tab / .studio-mode-tab-active
.studio-dropzone / .studio-dropzone-active
.studio-file-list / .studio-file-item
.studio-gas-estimate / .studio-deploy-btn
```

#### My Content Patterns (`.mc-*`) - v6.4

The My Content tab in Studio uses a dedicated prefix:

```css
/* Stats Row */
.mc-stats-row       /* Flex row: stats + refresh button */
.mc-stat            /* Individual stat container */
.mc-stat-value      /* Large cyan number */
.mc-stat-label      /* Uppercase muted label */

/* Tabs */
.mc-tabs            /* Tab container (flex, gap: 2px) */
.mc-tab             /* Individual tab button */
.mc-tab.active      /* Active state (cyan bg) */

/* Content List */
.mc-content-list    /* Scrollable list (max-height: 400px) */
.mc-content-item    /* Individual content row */
.mc-item-type       /* DOC/INDEX badge */
.mc-item-name       /* Content name */
.mc-item-scid       /* SCID (monospace, muted, truncated) */
```

**Layout:**
```html
<div class="content-card">
  <div class="mc-stats-row">
    <div class="mc-stat">...</div>
    <button class="btn btn-ghost btn-sm">Refresh</button>
  </div>
  <div class="mc-tabs">...</div>
  <div class="mc-content-list">...</div>
  <div class="info-panel">...</div>
</div>
```

### Info Panel Pattern (v6.4)

Standard pattern for helpful notes/tips at the bottom of content sections:

```html
<div class="info-panel">
  <div class="info-panel-header">
    <span class="info-panel-icon">◎</span>
    <span class="info-panel-title">About My Content</span>
  </div>
  <ul class="info-panel-list">
    <li>Tip or explanation point</li>
    <li>Another helpful note</li>
  </ul>
</div>
```

**CSS:**
```css
.info-panel {
  margin-top: var(--s-5);
  padding: var(--s-4);
  background: var(--void-deep);
  border: 1px solid var(--border-subtle);
  border-radius: var(--r-md);
}

.info-panel-header {
  display: flex;
  align-items: center;
  gap: var(--s-2);
  margin-bottom: var(--s-3);
}

.info-panel-icon {
  color: var(--cyan-400);
  font-size: 14px;
}

.info-panel-title {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: var(--text-2);
}

.info-panel-list {
  margin: 0;
  padding-left: var(--s-5);
  color: var(--text-3);
  font-size: 12px;
  line-height: 1.6;
}

.info-panel-list li::marker {
  color: var(--cyan-400);
}
```

**Key points:**
- Always use filled Unicode icon (◎, ◉, ⬢)
- Title is uppercase with letter-spacing
- List items have cyan bullet markers
- Used in Studio (Clone, My Content, etc.)

### Generic Patterns

Use these for common UI states:

```css
.loading-state / .loading-state.overlay  /* Loading containers */
.loading-spinner / .loading-spinner.lg / .loading-spinner.sm
.loading-text
.empty-state / .empty-state-icon / .empty-state-title
```

---

## 🧱 SVELTE CSS ARCHITECTURE

### When to Use Global Styles (hologram.css)

- Design tokens (colors, spacing, typography)
- Layout patterns (page-content, page-sidebar, card-wrapper)
- Page-specific patterns (settings-*, browser-*, wallet-*, studio-*)
- Shared patterns (modal-*, cmd-*, holo-*)
- **Any pattern used in 2+ components**

### When to Use Scoped Styles (component `<style>`)

- Component-specific animations
- Unique visual treatments not shared elsewhere
- Internal component structure (one-off layouts)
- Overrides for specific instances

### Wrapper Components

Wrapper components rendered inside `.page-content` should:
- Set `padding: 0` on their root element
- Rely on parent `.page-content` for padding
- Not add margins that break parent layout

### Pattern Priority

1. **Check if pattern exists in hologram.css** → USE IT
2. **If pattern is needed in 2+ places** → ADD to hologram.css
3. **If truly unique to one component** → Scoped style OK

---

## 🎁 SHARED COMPONENTS (holo/)

### Available Components

Import from `$lib/components/holo`:

```javascript
import { 
  // Display
  HoloCard, HoloBadge, RingProgress, DotIndicator,
  // Form
  HoloButton, HoloInput,
  // Feedback
  HoloAlert, EmptyState, LoadingSpinner,
  // Icons
  Icons
} from '$lib/components/holo';
```

### HoloButton

```svelte
<HoloButton variant="primary" loading={isLoading}>Submit</HoloButton>
<HoloButton variant="secondary">Cancel</HoloButton>
<HoloButton variant="danger">Delete</HoloButton>
<HoloButton variant="ghost">Link</HoloButton>
```

Variants: `primary` | `secondary` | `ghost` | `danger`
Props: `block`, `disabled`, `loading`, `type`, `href`

### HoloInput

```svelte
<HoloInput label="Address" hint="Enter DERO address" error={errorMsg} />
<HoloInput mono copyable value={scid} readonly />
```

Props: `label`, `hint`, `error`, `type`, `placeholder`, `value`, `disabled`, `readonly`, `mono`, `copyable`

### HoloAlert

```svelte
<HoloAlert variant="error" dismissible>Something went wrong</HoloAlert>
<HoloAlert variant="success">Transaction sent!</HoloAlert>
```

Variants: `error` | `warning` | `success` | `info`
Props: `dismissible`, `icon`

### EmptyState

```svelte
<EmptyState 
  icon="inbox" 
  title="No results" 
  description="Try a different search term"
>
  <HoloButton variant="secondary">Clear filters</HoloButton>
</EmptyState>
```

Props: `icon`, `title`, `description`
Slots: `default` (actions), `icon`

### LoadingSpinner

```svelte
<LoadingSpinner size={32} text="Loading..." />
<LoadingSpinner overlay />
<LoadingSpinner inline size={20} />
```

Props: `size`, `text`, `overlay`, `inline`

---

## 🔒 FINAL WORDS

This rulebook is **ABSOLUTE**. Any deviation weakens the design system. When in doubt:
- Choose the darker option
- Choose the simpler solution
- Choose subtle over flashy
- Choose consistent over unique

**The goal is a cohesive, professional, dark interface that feels like it belongs in a high-tech command center, not a consumer app.**

---

## 📜 Changelog

| Version | Date | Changes |
|---------|------|---------|
| v1.5 | Dec 14, 2025 | Initial public rulebook |
| v1.6 | Dec 26, 2025 | Checkbox SVG fix (stroke-based), Icon fallback pattern, My Content patterns (`.mc-*`), Info Panel pattern |

---

*End of HOLOGRAM Design System Rulebook v1.6*
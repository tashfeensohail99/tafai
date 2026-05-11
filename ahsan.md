# Tafsheen Design System — Handover

**For:** Ahsan + team
**From:** Frontend
**Status:** Live — all sales workspace screens, login, and admin chrome consume this.

This is the contract every module in the Tafsheen app must follow. If your
team's module follows the rules in this document, when we combine the modules
the UI will look identical — same fonts, same spacing, same buttons, same
dark/light toggle, same everything.

Read [§1 The Contract](#1-the-contract) and [§2 Quick Start](#2-quick-start)
before writing any UI. The rest is reference.

---

## Table of contents

0. [TL;DR](#0-tldr)
1. [The contract](#1-the-contract)
2. [Quick start — your first screen](#2-quick-start--your-first-screen)
3. [Architecture](#3-architecture)
4. [The theme provider](#4-the-theme-provider)
5. [Token catalogue (complete)](#5-token-catalogue-complete)
6. [Component kit — what's available](#6-component-kit--whats-available)
7. [Copy-paste patterns](#7-copy-paste-patterns)
8. [Anti-patterns — what NOT to do](#8-anti-patterns--what-not-to-do)
9. [Adding new tokens](#9-adding-new-tokens)
10. [Adding a new module](#10-adding-a-new-module)
11. [Migrating legacy code](#11-migrating-legacy-code)
12. [FAQ / troubleshooting](#12-faq--troubleshooting)
13. [Pre-PR checklist](#13-pre-pr-checklist)

---

## 0. TL;DR

```
ONE provider.    components/layout/ThemeProvider.tsx wraps <body> in app/layout.tsx
ONE attribute.   data-theme="light" | "dark" on <html>
ONE storage key. localStorage 'tafsheen-theme'
ONE toggle.      <ThemeToggle /> from components/layout/ThemeToggle.tsx
ONE token system. --sos-* (premium glass) defined in styles/sales-os.css
ONE doc.         styles/THEME.md (the rules); this file is the onboarding guide

DO        consume tokens via var(--sos-*) or the .sos-* utility classes
DO        use the kit primitives from @/components/sales-v2/ui
DO        click the topbar toggle and verify your screen in BOTH modes
DON'T     hardcode colour, shadow, radius, gradient, font, or border value
DON'T     create a new theme provider, attribute, or storage key
DON'T     extend the legacy --color-* tokens — they're frozen
```

---

## 1. The contract

These are the **hard rules**. Code review rejects anything that breaks them.

1. **No hardcoded visual values in JSX or CSS.** Every colour, shadow, radius,
   border, gradient, and font must be a `var(--sos-*)` reference or come from
   the kit. The only place raw `#hex` / `rgb()` / shadow strings are allowed
   is inside the token definitions in `styles/sales-os.css`.
2. **One token system per surface.** New screens use `--sos-*`. Do not mix
   `--color-*` (legacy) into a new screen — it works but creates visual drift.
3. **Brand identity is theme-agnostic.** `--sos-brand-primary`,
   `--sos-brand-deep`, and the brand gradients stay constant across light and
   dark. You don't override the brand per theme.
4. **Status hexes flip per theme.** Use `--sos-status-{tone}` — the dark
   mode bright hex and the light mode AAA-contrast hex are both behind the
   token name. Never reach for the underlying hex.
5. **Theme toggle must not cause a layout shift.** All structural tokens
   (radii, spacing, typography, layout, fonts) live in a single
   theme-agnostic block. If you add a token that defines a dimension,
   make sure it sits in the agnostic block, not in light/dark.
6. **A component does not know which theme it is in.** No `useTheme().theme ===
   'dark' ? X : Y` in component bodies. The CSS variables do the flipping.
   `useTheme` is only used when you genuinely need the value (rare).

---

## 2. Quick start — your first screen

Build a simple page that shows the system in action. Drop this into your
module's directory and adapt:

```tsx
// app/(your-module)/your-screen/page.tsx
'use client';

import { Sparkles, ArrowRight, Users } from 'lucide-react';
import {
  ButtonLink,
  GlassCard,
  MetricCard,
  PageHeader,
  PrimaryButton,
  SecondaryButton,
  StatusBadge,
} from '@/components/sales-v2/ui';

export default function YourScreen() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
      <PageHeader
        eyebrow="Your module"
        title={<>Build something premium.<br />Fast.</>}
        description="Every value below comes from a token. Click the topbar sun/moon to verify both themes."
        actions={
          <>
            <PrimaryButton iconLeft={<Sparkles size={15} />}>Get started</PrimaryButton>
            <SecondaryButton iconRight={<ArrowRight size={15} />}>Docs</SecondaryButton>
          </>
        }
      />

      <section
        style={{
          display: 'grid',
          gap: '16px',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
        }}
      >
        <MetricCard label="Users" value={1284} hint="Active this week" tone="accent" Icon={Users} />
        <MetricCard label="Errors" value={3} hint="Last 24h" tone="danger" Icon={Users} />
        <MetricCard label="Uptime" value="99.98%" hint="Rolling 30d" tone="success" Icon={Users} />
      </section>

      <GlassCard variant="strong" padded="lg">
        <div className="sos-eyebrow">Sample card</div>
        <h2 className="sos-title" style={{ fontSize: '17px', marginTop: '6px' }}>
          Your content sits in a glass surface.
        </h2>
        <p
          className="sos-text-secondary"
          style={{ marginTop: '8px', fontSize: '14px', lineHeight: 1.6 }}
        >
          Hover the card to see the elevation transition. Both modes look correct because
          surface, border, and shadow values are tokenized.
        </p>
        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <StatusBadge tone="success">Active</StatusBadge>
          <StatusBadge tone="warning">Pending</StatusBadge>
          <StatusBadge tone="danger">Blocked</StatusBadge>
        </div>
      </GlassCard>
    </div>
  );
}
```

That's it. Theme toggle in the topbar will switch this page between light and
dark without you doing anything else.

---

## 3. Architecture

```
app/layout.tsx                       (root)
  └─ <ThemeProvider>                 wraps <body>
       └─ writes data-theme="light|dark" on <html>
            ↓
       styles/sales-os.css            --sos-* tokens
       styles/tokens.css              --color-* legacy (admin only)
            ↓
       every screen, every workspace, themed identically
```

**File map:**

```
apps/frontend/
├── app/
│   ├── layout.tsx                              ROOT — wraps <ThemeProvider>
│   ├── (admin)/...
│   ├── (auth)/login/page.tsx                   uses --sos-* + <ThemeToggle>
│   ├── (employee)/...                          sales workspace (EmployeeShell)
│   ├── (partner)/...
│   └── (client)/...
├── components/
│   ├── layout/
│   │   ├── ThemeProvider.tsx                   THE ONLY THEME PROVIDER
│   │   ├── ThemeToggle.tsx                     THE ONLY THEME TOGGLE
│   │   ├── EmployeeShell.tsx                   sales workspace shell
│   │   ├── AdminShell.tsx                      admin workspace shell
│   │   ├── AppShell.tsx                        partner/client/auth shells
│   │   ├── Sidebar.tsx                         shared sidebar (admin/auth/partner)
│   │   └── Topbar.tsx                          shared topbar (admin/auth/partner)
│   ├── sales-v2/ui/                            THE COMPONENT KIT
│   │   ├── GlassCard.tsx
│   │   ├── PageHeader.tsx
│   │   ├── MetricCard.tsx
│   │   ├── StatusBadge.tsx
│   │   ├── Buttons.tsx                         Primary/Secondary/Ghost/Danger/Success/Link
│   │   ├── FormFields.tsx                      Field/FormInput/FormSelect/FormTextarea
│   │   ├── DrawerMenu.tsx
│   │   ├── ActionBar.tsx                       sticky footer
│   │   ├── EmptyState.tsx
│   │   ├── DetailPageShell.tsx                 two-column main+aside layout
│   │   ├── TimelineStep.tsx                    + Timeline wrapper
│   │   ├── UploadBox.tsx                       drag/drop file upload
│   │   ├── RoleBadge.tsx
│   │   └── index.ts                            <- import everything from here
│   └── shared/...                              legacy admin shared components
└── styles/
    ├── globals.css                              base resets + Tailwind import
    ├── tokens.css                               legacy --color-* (admin/auth)
    ├── sales-os.css                             --sos-* tokens + .sos-* utility CSS
    └── THEME.md                                 rules / contract
```

**The cascade order in `globals.css`:**

```css
@import 'tailwindcss';
@import './tokens.css';      /* legacy --color-* */
@import './sales-os.css';    /* canonical --sos-* */
```

---

## 4. The theme provider

```tsx
// components/layout/ThemeProvider.tsx
import { ThemeProvider, useTheme, type Theme } from '@/components/layout/ThemeProvider';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
```

### How it works

- Wraps `<body>` in the root layout. **Do not wrap it again inside your module.**
- Initial render uses `defaultTheme='light'` to match SSR.
- After hydration, reads `localStorage.tafsheen-theme` → falls back to
  `prefers-color-scheme: dark` → falls back to `'light'`.
- Toggling calls `setAttribute('data-theme', ...)` on `<html>` and persists.

### `useTheme()` returns

```ts
{
  theme: 'light' | 'dark';
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isHydrating: boolean;   // true until client preferences resolved — use to suppress flicker
}
```

### When you should and shouldn't call `useTheme`

| You want to… | Use `useTheme`? |
|---|---|
| Change a colour based on theme | **No.** Use a token. The token already flips. |
| Render a different icon per theme (sun/moon) | Yes — but only for theme-toggle-like UI |
| Render a different image asset per theme | Yes — e.g. `theme === 'dark' ? darkLogo : lightLogo` |
| Conditionally render the toggle button | No — just use `<ThemeToggle />` |
| Set a fallback while hydrating | Yes — check `isHydrating` and render a placeholder |

### Rendering the toggle

```tsx
<ThemeToggle />            // 38px icon button (sun/moon, matches topbar style)
<ThemeToggle size="sm" />  // small button with label ("Light" / "Dark")
```

Place it in your topbar. Every workspace toggle modifies the same `<html>`
attribute, so changing the theme in admin also changes it in sales and vice
versa. That's the point.

---

## 5. Token catalogue (complete)

The full token block is in [`styles/sales-os.css`](apps/frontend/styles/sales-os.css).
This section explains what each token is for and shows the dark / light values
side-by-side.

The file has three blocks:

1. **`:root`** (the first `:root` block) — **theme-agnostic structural tokens**.
   Radii, spacing, typography, layout. Never override these per theme.
2. **`:root`** (the second `:root` block) — **light theme** (default / SSR
   fallback). Surface, text, brand, status, borders, shadows, sidebar, etc.
3. **`:root[data-theme='dark']`** — **dark theme overrides**. Same token names,
   different values. Higher specificity (extra `:root` qualifier) so source
   order doesn't matter.

### 5.1 Structural (theme-agnostic)

**Radii**

| Token | Value | Use |
|---|---|---|
| `--sos-radius-xs` | 8px | Chips, small pills |
| `--sos-radius-sm` | 12px | Inset surfaces, file rows, tile inner padding |
| `--sos-radius-button` | 14px | Buttons, segmented controls |
| `--sos-radius-input` | 14px | Inputs, selects, textareas |
| `--sos-radius-pill` | 999px | Pills, badges, round controls |
| `--sos-radius-card` | 22px | Glass cards default |
| `--sos-radius-panel` | 28px | `GlassCard variant="panel"` |
| `--sos-radius-hero` | 32px | `GlassCard variant="hero"` (PageHeader) |

**Spacing** (use the `--sos-space-*` scale instead of magic numbers):

| Token | Value |
|---|---|
| `--sos-space-1` | 4px |
| `--sos-space-2` | 8px |
| `--sos-space-3` | 12px |
| `--sos-space-4` | 16px |
| `--sos-space-5` | 20px |
| `--sos-space-6` | 24px |
| `--sos-space-7` | 28px |
| `--sos-space-8` | 32px |
| `--sos-space-10` | 40px |
| `--sos-space-12` | 48px |
| `--sos-space-16` | 64px |

**Typography**

| Token | Value |
|---|---|
| `--sos-font-sans` | `'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif` |
| `--sos-font-display` | `'Iowan Old Style', 'Palatino Linotype', 'URW Palladio L', Baskerville, Georgia, serif` |
| `--sos-text-xs` | 11px |
| `--sos-text-sm` | 12.5px |
| `--sos-text-base` | 14px |
| `--sos-text-md` | 15px |
| `--sos-text-lg` | 17px |
| `--sos-text-xl` | 20px |
| `--sos-text-2xl` | 26px |
| `--sos-text-3xl` | 34px |
| `--sos-text-display` | `clamp(2.2rem, 4vw, 3.6rem)` |
| `--sos-letter-eyebrow` | 0.18em (uppercase tracking for eyebrows) |
| `--sos-letter-tight` | -0.04em (display headlines) |

Use the **display** font (Iowan / Palatino fallback to Georgia) for hero
headlines. Use **sans** (Inter) for everything else — body, labels, buttons.

**Layout**

| Token | Value |
|---|---|
| `--sos-sidebar-width` | 280px |
| `--sos-sidebar-collapsed` | 72px |
| `--sos-topbar-height` | 72px |
| `--sos-content-max` | 1500px |

### 5.2 Theme-flipping tokens (light / dark)

**Surfaces (page backdrop)** — page bg + glass card backgrounds:

| Token | Light | Dark | Use |
|---|---|---|---|
| `--sos-bg-app` | `#e9eef7` | `#050b1e` | Page background |
| `--sos-bg-deep` | `#dde4f0` | `#02060f` | Page deep gradient stop |
| `--sos-bg-elevated` | `#ffffff` | `#0a1530` | Solid elevated panel |
| `--sos-bg-glass-top/-bottom` | white 94% / 78% | navy 72% / 46% | `GlassCard` default |
| `--sos-bg-glass-strong-top/-bottom` | white 98% / 86% | navy 86% / 62% | `GlassCard variant="strong"` |
| `--sos-bg-glass-soft-top/-bottom` | slate 2.5% / 1% | white 6% / 2% | `GlassCard variant="soft"` |
| `--sos-bg-input` | `#ffffff` | navy 72% | Form input idle bg |
| `--sos-bg-input-focus` | `#ffffff` | navy 86% | Form input focused bg |
| `--sos-bg-overlay` | slate 32% | black 56% | Drawer / modal backdrop |
| `--sos-bg-banner` | white 86% | navy 60% | `.sos-banner` default |
| `--sos-bg-dropzone` | white 60% | navy 40% | Upload dropzone |
| `--sos-bg-secondary-hover` | slate 4% | navy 78% | Secondary button hover |
| `--sos-bg-topbar-icon-hover` | slate 4% | navy 70% | Topbar icon button hover |
| `--sos-bg-row-top/-bottom` | white 78% / 50% | navy 62% / 42% | List row default |
| `--sos-bg-row-hover-top/-bottom` | white 92% / 70% | navy 70% / 50% | List row hover |
| `--sos-bg-actionbar-top/-bottom` | white 92% / 78% | navy 86% / 74% | Sticky action footer |

**Surface tiers (inset)** — small backgrounds inside glass cards:

| Token | Light | Dark | Decision tree |
|---|---|---|---|
| `--sos-surface-1` | slate 2.5% | white 3% | Rest state of inset blocks, file rows |
| `--sos-surface-2` | slate 4% | white 4% | Hover for surface-1 / KBD shortcuts |
| `--sos-surface-3` | slate 6% | white 6% | Tab hover, ghost button hover, focus halos |
| `--sos-surface-4` | slate 8% | white 8% | Stronger inset (rare) |
| `--sos-surface-tint-on-accent` | white 32% | white 16% | Inset border on top of brand fill |
| `--sos-surface-progress-track` | slate 6% | white 6% | Progress bar track |
| `--sos-surface-tab-count` | slate 6% | white 8% | Tab counter chip (idle) |
| `--sos-surface-tab-count-on` | white 28% | black 18% | Tab counter chip (selected) |

**Text**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--sos-text-primary` | `#0f172a` | `#f5f9ff` | Headings, primary content |
| `--sos-text-secondary` | `#334155` | white 78% | Body, paragraph copy |
| `--sos-text-muted` | `#64748b` | white 58% | Labels, captions, hints |
| `--sos-text-faint` | `#94a3b8` | white 42% | Eyebrows, microcopy, disabled |
| `--sos-text-inverse` | `#ffffff` | `#061226` | Text on inverted surface |
| `--sos-text-on-accent` | `#ffffff` | `#061226` | Text on brand gradient |
| `--sos-text-on-success/-danger/-warm` | `#ffffff` / `#ffffff` / `#2a1c00` | navy/red/gold-anchor | Text on filled status buttons |

**Brand**

| Token | Light | Dark |
|---|---|---|
| `--sos-brand-primary` | `#0891b2` | `#38c3e8` |
| `--sos-brand-primary-strong` | `#0e7490` | `#5dd4f2` |
| `--sos-brand-primary-soft` | cyan 14% | cyan 14% |
| `--sos-brand-primary-border` | cyan 40% | cyan 32% |
| `--sos-brand-accent` | `#c98e3b` | `#f0c87a` |
| `--sos-brand-accent-soft` | gold 20% | gold 16% |
| `--sos-brand-accent-border` | gold 45% | gold 32% |
| `--sos-brand-deep` | `#0c2155` | `#0c2155` (**same — brand identity**) |
| `--sos-brand-gradient` | `linear-gradient(135deg, #38c3e8 → #2492c4 → #0c2155)` | (same — brand identity) |
| `--sos-brand-warm-gradient` | `linear-gradient(135deg, #f0c87a → #c98e3b)` | (same) |

**Status** — nine tones, each with `soft` (background) and `border`:

| Tone | `--sos-status-{tone}` (light / dark) |
|---|---|
| success | `#059669` / `#34d399` |
| warning | `#d97706` / `#fbbf24` |
| danger | `#dc2626` / `#f87171` |
| info | `#2563eb` / `#60a5fa` |
| violet | `#7c3aed` / `#a78bfa` |
| cyan | `#0891b2` / `#22d3ee` |
| pink | `#db2777` / `#f472b6` |
| neutral | `#475569` / light-slate-blue |

Always use the trio together:

```tsx
style={{
  background: 'var(--sos-status-success-soft)',
  color: 'var(--sos-status-success)',
  border: '1px solid var(--sos-status-success-border)',
}}
```

**Borders**

| Token | Light | Dark |
|---|---|---|
| `--sos-border-subtle` | slate 7% | blue-white 12% |
| `--sos-border` | slate 12% | blue-white 18% |
| `--sos-border-strong` | slate 20% | blue-white 28% |
| `--sos-border-accent` | cyan 55% | cyan 42% (focus ring) |
| `--sos-divider` | slate 7% | blue-white 10% |

**Shadows**

| Token | Use |
|---|---|
| `--sos-shadow-xs` | hairline drop |
| `--sos-shadow-sm` | small card |
| `--sos-shadow-md` | medium card / topbar |
| `--sos-shadow-lg` | large modal |
| `--sos-shadow-glass` | signature glass shadow with white inset (top-edge sheen) |
| `--sos-shadow-glass-hover` | `GlassCard hover` |
| `--sos-shadow-glow` | brand-tinted glow (primary CTA, active avatar) |
| `--sos-shadow-glow-hover` | brand glow on hover |
| `--sos-shadow-warm` | gold-tinted glow |
| `--sos-shadow-button-danger/-success` | filled status button drops |
| `--sos-shadow-nav-active/-glow` | sidebar active item |

Light values are slate-tinted at ~6-14% alpha. Dark values are black at ~32-50% alpha.

**Decorative blur glows** — for the big blurred circles inside `PageHeader` / `GlassCard glow`:

| Token | Light | Dark |
|---|---|---|
| `--sos-glow-primary` | cyan 28% | cyan 18% |
| `--sos-glow-warm` | gold 24% | gold 16% |

Light alphas are intentionally higher because blur(80-90px) dilutes more on white.

**Avatar gradients**

| Token | Light | Dark | Use |
|---|---|---|---|
| `--sos-avatar-muted-gradient` | slate-400→500 | slate-600→800 | Past / inactive avatars |
| `--sos-avatar-danger-gradient` | red-400→red-700 | (same) | Overdue / alarm avatars |

**Sidebar** (15 tokens, all theme-flipping) — see `sales-os.css`. Highlights:

| Token | Use |
|---|---|
| `--sos-sidebar-bg-top/-bottom` | gradient (cream→white in light, navy→navy in dark) |
| `--sos-sidebar-text/-strong/-muted/-faint/-section` | text hierarchy on the sidebar |
| `--sos-sidebar-line` | separators |
| `--sos-sidebar-active-bg/-active-bg-strong/-active-edge` | active item background + edge bar |
| `--sos-sidebar-hover` | hover surface |
| `--sos-sidebar-icon-bg` | idle nav-icon background |
| `--sos-sidebar-panel-top/-bottom` | resource panel gradient |
| `--sos-sidebar-glow-1/-glow-2` | radial decoration glows |

**Topbar**

| Token | |
|---|---|
| `--sos-topbar-bg` | gradient |
| `--sos-topbar-border` | `var(--sos-border)` |

**Backdrops** (page-level decoration):

| Token | |
|---|---|
| `--sos-backdrop-1/-2/-3` | three radial glows that layer behind every page |
| `--sos-backdrop-base` | linear page gradient (app → deep) |
| `--sos-backdrop-glow-1/-2` | inner glow radials in `.sos-shell::before` |

**Scrollbar**

| Token | |
|---|---|
| `--sos-scrollbar-thumb` | thumb idle |
| `--sos-scrollbar-thumb-hover` | thumb hover |

---

## 6. Component kit — what's available

Import everything from one place:

```tsx
import {
  // Surfaces
  GlassCard, PageHeader, MetricCard, EmptyState, ActionBar,

  // Form
  Field, FormInput, FormSelect, FormTextarea,

  // Buttons
  PrimaryButton, SecondaryButton, GhostButton, DangerButton, SuccessButton, ButtonLink,

  // Indicators
  StatusBadge, RoleBadge,

  // Layout
  DetailPageShell, DrawerMenu,

  // Timeline
  Timeline, TimelineStep,

  // Upload
  UploadBox,

  // Theme
  ThemeProvider, ThemeToggle, useTheme, type Theme,
} from '@/components/sales-v2/ui';
```

### Quick reference

| Component | Variants / size | When to use |
|---|---|---|
| `<GlassCard>` | `variant`: default/strong/soft/panel/hero; `padded`: sm/md/lg/false; `hover`; `glow`: none/accent/warm | Every card surface |
| `<PageHeader>` | `eyebrow` / `title` / `description` / `actions` / `meta` | Top of every page (the hero) |
| `<MetricCard>` | `tone`: accent/warm/success/warning/danger/info/neutral | KPI tiles |
| `<StatusBadge>` | `tone`: all 9; `size`: sm/md/lg; `dot`: true/false | Inline status pill |
| `<RoleBadge>` | (no variants) | Role chip in topbar |
| `<PrimaryButton>` etc. | `size`: sm/md/lg; `iconLeft`; `iconRight`; `fullWidth` | All buttons |
| `<ButtonLink>` | `variant`: primary/secondary/ghost/danger/success/warm | Link styled as button |
| `<Field>` | wraps any input with label + hint + error | Form fields |
| `<FormInput>` | `inputSize`: md/lg; `iconLeft` | Text inputs |
| `<FormSelect>` | options array | Dropdowns |
| `<FormTextarea>` | `inputSize`: md/lg | Multiline |
| `<EmptyState>` | `Icon` / `title` / `description` / `action` | "No results" |
| `<ActionBar>` | `left` / `right` / `hint` / `sticky` | Sticky save/discard footer |
| `<DetailPageShell>` | `header` / `main` / `aside` / `actionBar` | Two-column detail layout |
| `<Timeline>` + `<TimelineStep>` | step list with bullets | Activity / progress |
| `<UploadBox>` | `accept` / `onFileSelected` | Drag/drop upload |
| `<DrawerMenu>` | `items` array of nav links | Sidebar navigation |

### Utility classes (from `sales-os.css`)

When you don't want to compose with the React kit (e.g. native `<button>`),
use the matching CSS classes:

```
.sos-glass[, --strong, --soft, --panel, --hero]
.sos-eyebrow      uppercase 10.5px brand-faint label
.sos-display      display font for hero titles
.sos-title        700 weight title
.sos-text-secondary/-muted/-faint
.sos-btn[, --primary, --secondary, --ghost, --danger, --success, --warm, --sm, --lg, --full]
.sos-input        .sos-input--lg
.sos-select       .sos-select-lg
.sos-textarea     .sos-textarea--lg
.sos-label        uppercase form label
.sos-help / .sos-help--error
.sos-input-group  .sos-input-group__icon
.sos-badge[, --success, --warning, --danger, --info, --violet, --cyan, --pink, --neutral, --accent, --warm, --plain, --lg]
.sos-metric       (KPI tile)
.sos-tabs / .sos-tab[aria-pressed='true'] / .sos-tab__count
.sos-actionbar    sticky footer
.sos-avatar[, --lg, --xl, --ring]
.sos-progress / .sos-progress__fill
.sos-banner[, --success, --warning, --danger, --info]
.sos-timeline / .sos-timeline-item[--done]
.sos-dropzone
.sos-pill[, --accent]
.sos-row          generic list row
.sos-scroll       scrollbar styling
.sos-no-scrollbar hide scrollbar
.sos-stat-chip    small inline KPI
```

---

## 7. Copy-paste patterns

### 7.1 Page header

```tsx
<PageHeader
  eyebrow="Module name"
  title={<>Your big title.<br />Two lines tops.</>}
  description="One sentence about what the user can do here. Cite live counts when you can."
  actions={
    <>
      <PrimaryButton iconLeft={<Plus size={15} />}>New thing</PrimaryButton>
      <SecondaryButton iconLeft={<Sliders size={15} />}>Filters</SecondaryButton>
    </>
  }
/>
```

### 7.2 KPI row

```tsx
<section
  style={{
    display: 'grid',
    gap: '16px',
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  }}
>
  <MetricCard label="Active" value={42} hint="In progress today" tone="accent" Icon={Activity} />
  <MetricCard label="Overdue" value={3} hint="Need attention" tone="danger" Icon={CircleAlert} />
  <MetricCard label="Done" value={128} hint="This week" tone="success" Icon={CheckCircle2} />
</section>
```

### 7.3 Two-column detail layout

```tsx
<section
  style={{
    display: 'grid',
    gap: '20px',
    gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)',
  }}
  className="sos-detail-grid"  // makes it stack on narrow screens
>
  <GlassCard variant="strong" padded="lg">
    {/* Main content */}
  </GlassCard>

  <aside style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
    <GlassCard variant="default" padded="md">{/* Sidebar item 1 */}</GlassCard>
    <GlassCard variant="default" padded="md">{/* Sidebar item 2 */}</GlassCard>
  </aside>
</section>
```

### 7.4 Form fields

```tsx
<Field label="Email" required hint="Use your work address.">
  <FormInput
    type="email"
    iconLeft={<Mail size={14} />}
    inputSize="lg"
    value={email}
    onChange={(e) => setEmail(e.target.value)}
    placeholder="you@company.com"
  />
</Field>

<FormSelect
  label="Country"
  required
  value={country}
  onChange={(e) => setCountry(e.target.value)}
  options={[
    { value: 'CA', label: 'Canada' },
    { value: 'AU', label: 'Australia' },
  ]}
/>

<FormTextarea
  label="Note"
  hint="Anything finance should know."
  value={note}
  onChange={(e) => setNote(e.target.value)}
  style={{ minHeight: 120 }}
/>
```

### 7.5 Selectable tile

When you need a custom selectable card (e.g. "pick a meeting type"):

```tsx
function PickTile({ active, onClick, Icon, title, caption, tone }: {...}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        all: 'unset',
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'flex-start',
        gap: '12px',
        padding: '16px',
        borderRadius: 'var(--sos-radius-sm)',
        border: active ? '1.5px solid ' + tone : '1px solid var(--sos-border)',
        background: active
          ? 'color-mix(in srgb, ' + tone + ' 12%, transparent)'
          : 'var(--sos-surface-1)',
        boxShadow: active ? `0 0 0 3px color-mix(in srgb, ${tone} 18%, transparent)` : 'none',
        transition: 'all 160ms ease',
      }}
    >
      <div
        style={{
          width: '40px',
          height: '40px',
          borderRadius: '12px',
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in srgb, ' + tone + ' 18%, transparent)',
          color: tone,
          border: '1px solid color-mix(in srgb, ' + tone + ' 30%, transparent)',
        }}
      >
        <Icon size={18} />
      </div>
      <div>
        <div style={{ fontWeight: 700, color: 'var(--sos-text-primary)' }}>{title}</div>
        <div className="sos-text-muted" style={{ fontSize: '12px', marginTop: '4px' }}>
          {caption}
        </div>
      </div>
    </button>
  );
}
```

`tone` is a CSS variable name (e.g. `'var(--sos-status-info)'`). Using
`color-mix(in srgb, ${tone} X%, transparent)` lets you compose any percentage
of a tone without minting a new token.

### 7.6 Sticky action bar (save/discard)

```tsx
<ActionBar
  left={
    dirty ? (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
        <Clock4 size={14} style={{ color: 'var(--sos-status-warning)' }} />
        <span style={{ color: 'var(--sos-text-primary)', fontWeight: 600 }}>
          Unsaved changes
        </span>
      </span>
    ) : (
      <span className="sos-text-muted" style={{ fontSize: '12.5px' }}>
        Ready to save.
      </span>
    )
  }
  right={
    <>
      <SecondaryButton onClick={handleReset} disabled={!dirty} iconLeft={<X size={15} />}>
        Discard
      </SecondaryButton>
      <PrimaryButton onClick={handleSave} disabled={!dirty} iconLeft={<Save size={15} />}>
        Save changes
      </PrimaryButton>
    </>
  }
/>
```

### 7.7 Inline alert / banner

```tsx
<div className="sos-banner sos-banner--warning">
  <AlertTriangle size={14} />
  <span>
    <strong>Heads up:</strong> Something needs attention.
  </span>
</div>
```

Variants: `--success`, `--warning`, `--danger`, `--info`.

### 7.8 Tabs

```tsx
<div
  className="sos-no-scrollbar"
  style={{
    display: 'flex',
    gap: '6px',
    padding: '4px',
    background: 'var(--sos-bg-input)',
    border: '1px solid var(--sos-border)',
    borderRadius: 'var(--sos-radius-button)',
    overflowX: 'auto',
  }}
>
  {tabs.map((t) => (
    <button
      key={t.key}
      type="button"
      aria-pressed={active === t.key}
      onClick={() => setActive(t.key)}
      className="sos-tab"
    >
      {t.label}
      {t.count != null ? <span className="sos-tab__count">{t.count}</span> : null}
    </button>
  ))}
</div>
```

### 7.9 Status badges

```tsx
<StatusBadge tone="success">Verified</StatusBadge>
<StatusBadge tone="warning">Pending</StatusBadge>
<StatusBadge tone="danger" size="sm">Overdue</StatusBadge>
<StatusBadge tone="violet" dot={false} icon={<Globe size={11} />}>Global</StatusBadge>
```

### 7.10 Empty state

```tsx
<EmptyState
  Icon={Inbox}
  title="Nothing here yet"
  description="When data shows up, you'll see it here."
  action={<PrimaryButton iconLeft={<Plus size={14} />}>Create one</PrimaryButton>}
/>
```

### 7.11 Activity timeline

```tsx
<Timeline>
  <TimelineStep
    Icon={Shield}
    title="Submitted"
    meta="Yesterday"
    description="Application sent to processing."
    done
  />
  <TimelineStep
    Icon={Activity}
    title="Under review"
    meta="Today, 9:14 AM"
    description="Officer assigned: M. Khan."
  />
</Timeline>
```

---

## 8. Anti-patterns — what NOT to do

| ❌ Don't | ✅ Do |
|---|---|
| `style={{ background: '#ffffff' }}` | `style={{ background: 'var(--sos-bg-elevated)' }}` |
| `style={{ background: 'rgba(255,255,255,0.06)' }}` | `style={{ background: 'var(--sos-surface-3)' }}` |
| `style={{ color: '#0f172a' }}` | `style={{ color: 'var(--sos-text-primary)' }}` |
| `style={{ border: '1px solid rgb(56 195 232 / 0.32)' }}` | `style={{ border: '1px solid var(--sos-brand-primary-border)' }}` |
| `style={{ boxShadow: '0 18px 38px rgba(56,195,232,0.22)' }}` | `style={{ boxShadow: 'var(--sos-shadow-glow)' }}` |
| `style={{ borderRadius: '14px' }}` | `style={{ borderRadius: 'var(--sos-radius-button)' }}` |
| `style={{ padding: '16px' }}` | `style={{ padding: 'var(--sos-space-4)' }}` (or just `'16px'` for one-off) |
| `style={{ fontSize: '13px' }}` | `style={{ fontSize: 'var(--sos-text-sm)' }}` (or `'12.5px'` for one-off) |
| Creating a new theme provider in your module | Use the root one — `useTheme` from `components/layout/ThemeProvider` |
| Adding a new data attribute for theming (`data-mymodule-theme`) | Use `data-theme` |
| New `localStorage` key for theme | Use `tafsheen-theme` |
| `if (theme === 'dark') { ... }` in component body | Use tokens — they flip automatically |
| Reaching into `--color-*` from a new screen | Use `--sos-*` |
| Re-implementing `GlassCard` / `Button` / `Badge` | Import from `@/components/sales-v2/ui` |
| Inline-styled rectangles "to match the design" | Use kit primitives |

**The "one-off" rule:** spacing/font-size literals (`'16px'`, `'12.5px'`) are
tolerated when they're truly one-off and not part of a system. **Colour,
shadow, gradient, and border literals are NEVER tolerated** — they break
theming.

---

## 9. Adding new tokens

You need a new token when:

- An existing token doesn't fit your use case AND
- You can't compose what you need from `color-mix(in srgb, var(--sos-x) Y%, transparent)`.

**Process:**

1. Pick a name that fits the category. Use the existing prefix conventions:
   - `--sos-bg-*` for full backgrounds
   - `--sos-surface-{n}` for inset tiers (1-4)
   - `--sos-text-*` for text colour
   - `--sos-brand-*` for brand
   - `--sos-status-{tone}` / `-soft` / `-border` for status
   - `--sos-shadow-*` for shadows
   - `--sos-glow-*` for blurred decorative glows
   - `--sos-radius-*`, `--sos-space-*`, `--sos-text-*` (size) for structure
2. Open `styles/sales-os.css`.
3. Add it to **both** theme blocks (light `:root` AND `:root[data-theme='dark']`)
   with appropriate values.
4. If it's a structural token (dimension, radius, font), put it in the
   theme-agnostic block instead — **not** in either theme block.
5. Document the token in `THEME.md` (catalogue section) so future contributors
   know what it's for.
6. Use it.

**The audit:** to catch token-coverage mistakes, run this in the repo:

```bash
# Reports any --sos-* token defined in only one theme block
awk '
  /:root\[data-theme=.dark.\]/ { mode="dark"; next }
  /^:root \{$/ { mode=(mode=="agnostic"?"light":"agnostic"); next }
  /^\}/ { mode="" }
  mode && /--sos-/ {
    match($0, /--sos-[a-z0-9-]+/)
    if (RSTART > 0) print mode " " substr($0, RSTART, RLENGTH)
  }' styles/sales-os.css | sort -u | awk '...'
```

(Full script is in the `THEME.md` audit block.) Run it after any token edit.

---

## 10. Adding a new module

When you add a workspace module (e.g. Finance, HR, Processing, Compliance):

### Step 1. Pick your route group

```
apps/frontend/app/(finance)/
├── layout.tsx          uses your shell
├── finance/
│   ├── page.tsx        landing
│   ├── invoices/
│   └── ...
```

### Step 2. Build a shell

Copy the structure from `EmployeeShell.tsx`. Your shell:

- **Does not** wrap a `<ThemeProvider>`. The root layout does.
- **Does not** put `data-theme` on its container. The root layout does (on `<html>`).
- Uses `<ThemeToggle />` somewhere in its topbar.
- Consumes `--sos-*` tokens (or `.sos-*` utility classes).

Minimal template:

```tsx
// components/layout/FinanceShell.tsx
'use client';

import { useState, type ReactNode } from 'react';
import { ThemeToggle } from './ThemeToggle';

export function FinanceShell({ children }: { children: ReactNode }) {
  return (
    <div className="sos-shell">
      <aside className="sos-sidebar">
        {/* Your nav (use DrawerMenu from @/components/sales-v2/ui) */}
      </aside>

      <div className="sos-content">
        <header className="sos-topbar">
          <div style={{ flex: 1 }}>
            <div className="sos-breadcrumb">
              <span>Finance</span>
            </div>
            <div className="sos-topbar__title">Finance dashboard</div>
          </div>
          <ThemeToggle />
        </header>

        <main className="sos-page">{children}</main>
      </div>
    </div>
  );
}
```

### Step 3. Build pages using the kit

Every page uses `<PageHeader>`, `<GlassCard>`, `<MetricCard>`, etc. See
[§7 Copy-paste patterns](#7-copy-paste-patterns).

### Step 4. Test both themes before opening a PR

Click the sun/moon in the topbar. Walk through every page. Look for:

- Any element that "disappears" in one theme (likely a hardcoded value)
- Any element that shifts position (likely a structural token in the wrong block)
- Any element with wrong contrast (likely a status colour that should flip)

---

## 11. Migrating legacy code

If your module inherits older code that uses `--color-*` or the (long-gone)
`--sv-*` / `--sales-*` tokens, here's the substitution table:

### `--sv-*` → `--sos-*`

| Was | Use |
|---|---|
| `var(--sv-bg)` | `var(--sos-bg-app)` |
| `var(--sv-text)` | `var(--sos-text-primary)` |
| `var(--sv-text-muted)` | `var(--sos-text-muted)` |
| `var(--sv-text-faint)` | `var(--sos-text-faint)` |
| `var(--sv-card-soft)` | `var(--sos-surface-2)` |
| `var(--sv-card)` | use `GlassCard` instead |
| `var(--sv-border)` | `var(--sos-border)` |
| `var(--sv-border-soft/-strong)` | `var(--sos-border-subtle / -strong)` |
| `var(--sv-accent)` | `var(--sos-brand-primary)` |
| `var(--sv-st-{tone}-bg)` | `var(--sos-status-{tone}-soft)` |
| `var(--sv-st-{tone})` | `var(--sos-status-{tone})` |
| `.sv-input` | `.sos-input` |
| `.sv-label` | `.sos-label` |
| `.sv-eyebrow` | `.sos-eyebrow` |
| `.sv-banner` | `.sos-banner` + variant |
| `.sv-btn.sv-btn-primary` | `.sos-btn.sos-btn--primary` |
| `.sv-btn-ghost` | `.sos-btn.sos-btn--ghost` |
| `.sv-card / .sv-card-hover` | use `<GlassCard hover />` |
| `.sv-dropzone` | `.sos-dropzone` or `<UploadBox />` |
| `.sv-scroll` | `.sos-scroll` |

### `--color-*` (admin legacy) → `--sos-*`

| Was | Use |
|---|---|
| `var(--color-surface)` | `var(--sos-bg-elevated)` |
| `var(--color-surface-muted)` | `var(--sos-bg-app)` |
| `var(--color-surface-subtle)` | `var(--sos-surface-2)` |
| `var(--color-border)` | `var(--sos-border)` |
| `var(--color-border-strong)` | `var(--sos-border-strong)` |
| `var(--color-text-primary)` | `var(--sos-text-primary)` |
| `var(--color-text-secondary)` | `var(--sos-text-secondary)` |
| `var(--color-text-muted)` | `var(--sos-text-muted)` |
| `var(--color-text-disabled)` | `var(--sos-text-faint)` |
| `var(--color-text-inverse)` | `var(--sos-text-inverse)` |
| `var(--color-primary-{n})` | `var(--sos-brand-primary)` family |
| `var(--color-status-{tone})` | `var(--sos-status-{tone})` |
| `var(--color-status-{tone}-bg)` | `var(--sos-status-{tone}-soft)` |

> Migrate opportunistically. Don't rewrite an admin page just to migrate
> tokens. Migrate when you're touching that file for another reason.

---

## 12. FAQ / troubleshooting

**Q: My screen looks fine in dark mode but elements vanish in light mode.**
A: Almost always a hardcoded `rgb(255 255 255 / 0.0x)` somewhere — that white
tint is invisible on a white background. Grep your file for `rgb(` and
`rgba(`. Replace with `--sos-surface-{1-4}`.

**Q: My screen looks fine in light mode but elements look "muddy" in dark.**
A: You used a deep colour literal (e.g. `#0f172a`) that doesn't show against
dark. Use `var(--sos-text-primary)` — it flips automatically.

**Q: My layout shifts when I toggle the theme.**
A: A structural token (radius, spacing, layout dimension, font size) is
defined in only one theme block. Move it to the agnostic `:root` block at the
top of `sales-os.css`. Run the audit script (§9).

**Q: There's a brief flash of the wrong theme on first paint.**
A: SSR renders with no `data-theme` attribute, so `:root` (light) applies. If
the user prefers dark, you see a sub-100ms flash before the provider runs.
Acceptable. If it bothers you, write a tiny `<script>` in the `<head>` that
sets `data-theme` from localStorage before React hydrates — same pattern as
`next-themes`. Not yet implemented because the flash is small.

**Q: Can I use Tailwind classes for colour?**
A: Avoid — `bg-blue-500` won't flip with the theme. Tailwind utilities for
layout, flex, grid, spacing, typography are fine. Colour/border/shadow always
through tokens.

**Q: What about `color-mix()`?**
A: Encouraged when you need a one-off tint. Always use a token as the source
colour: `color-mix(in srgb, var(--sos-status-info) 18%, transparent)`. Never
mix raw hex.

**Q: Do I need to add a `<ThemeProvider>` in my route group's layout?**
A: No. The root `app/layout.tsx` already wraps everything. Adding another one
will work but is redundant and confusing.

**Q: Can I disable dark mode for my module?**
A: Not really — the global toggle flips everything. If you have a genuine
reason (e.g. a public-facing brand page that must always be light), wrap that
page's content in a div that overrides the relevant tokens for itself:

```tsx
<div style={{ '--sos-bg-app': '#fff', '--sos-text-primary': '#000', ... } as any}>
  {/* Always-light content */}
</div>
```

But talk to us first — usually the right answer is "make the screen look good
in both modes" not "freeze it".

**Q: My data table needs status colours.**
A: Use `var(--sos-status-{tone})` + `var(--sos-status-{tone}-soft)` +
`var(--sos-status-{tone}-border)`. Pattern in [§5.2 Status](#52-theme-flipping-tokens-light--dark).

**Q: How do I add an icon button that matches the topbar icon button style?**
A: `<button className="sos-topbar__icon-btn">...</button>`.

**Q: How do I make a custom card hover?**
A: Either use `<GlassCard hover>` (lifts on hover automatically) or add the
class `sos-glass-hover`.

**Q: What font should my module use?**
A: Don't set fontFamily on body or root — it's inherited from `<html>` which
is set to `--sos-font-sans` (Inter). For headlines use `className="sos-display"`
to switch to the display serif. Don't import a different font.

**Q: Where do I add a logo or brand asset?**
A: Store in `public/`, reference by URL. The asset itself doesn't theme — but
if you have light and dark variants, swap via `useTheme().theme`.

---

## 13. Pre-PR checklist

Before opening a PR with new UI:

- [ ] Searched my files for `rgb(`, `rgba(`, `#[0-9a-f]{6}`,
      `linear-gradient(135deg, #` — zero matches in style props.
- [ ] All status-tinted surfaces use the
      `--sos-status-{tone} / -soft / -border` trio.
- [ ] No hardcoded shadow strings — all use `--sos-shadow-*`.
- [ ] No hardcoded text colours — all use `--sos-text-*`.
- [ ] No hardcoded radius — all use `--sos-radius-*`.
- [ ] I did not create a new `ThemeProvider`, `data-*` attribute, or
      localStorage key.
- [ ] I imported the kit primitives from `@/components/sales-v2/ui` rather than
      re-implementing them.
- [ ] I clicked the topbar sun/moon and walked through every screen I
      touched in both themes.
- [ ] No layout shift between themes (sidebar width, card sizes, font sizes
      identical).
- [ ] No hydration warning in the dev console.

If all 10 boxes are checked, the PR should pass design review on theming.

---

## Contact

- Theme rules / contract: [`apps/frontend/styles/THEME.md`](apps/frontend/styles/THEME.md)
- Token source: [`apps/frontend/styles/sales-os.css`](apps/frontend/styles/sales-os.css)
- Kit components: [`apps/frontend/components/sales-v2/ui/`](apps/frontend/components/sales-v2/ui/)
- Provider + toggle: [`apps/frontend/components/layout/`](apps/frontend/components/layout/)

If you hit something not covered here, ping the frontend team. The system is
designed to be extended — if you need a new token or a new primitive, the
answer is usually "yes, add it" not "find a workaround". Adding goes through
the audit and gets documented in `THEME.md` so it stays consistent.

Welcome aboard. Let's make every Tafsheen screen feel like one app.

# Tafsheen — Design Tokens & Theme Rules

This document is the contract between the Tafsheen design system and every
workspace module (sales, finance, admin, partner, client, auth). Read it before adding
a colour, shadow, radius, or background to any UI under
`apps/frontend/components/`.

The system is **one component layer, two themes, one central provider**:

- `<ThemeProvider>` from `components/layout/ThemeProvider.tsx` wraps the whole
  app at the root layout level.
- It writes `data-theme="light"` or `data-theme="dark"` onto `<html>`.
- Two token vocabularies flip on that single attribute:
  - **`--sos-*`** (`styles/sales-os.css`) — **the canonical design system**.
    Used by sales and finance today; the target for every new screen across every module.
  - **`--color-*` / `--status-*`** (`styles/tokens.css`) — legacy admin/auth
    tokens that still drive the admin workspace, shared components, and the
    `AppShell` / `Topbar` / `Sidebar` chrome. **Frozen, do not extend.** New
    work consumes `--sos-*`. Existing admin pages migrate opportunistically.
- `<ThemeToggle>` from `components/layout/ThemeToggle.tsx` flips the attribute
  and persists to `tafsheen-theme` in localStorage.

There is **no module-level provider**, **no per-shell attribute**, **no
parallel theme system**. One toggle moves every workspace at once.

---

## TL;DR rules

1. **Never hardcode colour, shadow, radius, or border in JSX or CSS.**
   Every visual value must come from a `--sos-*` token.
2. **If a token does not exist for what you need, add one to both theme
   blocks.** Do not inline a raw `rgb(...)` / hex / shadow string.
3. **Tokens live only in `styles/sales-os.css`.** Both theme blocks must
   define the same set of variable names — only values differ.
4. **The kit (`components/sales-v2/ui/*`) is theme-pure.** Pages compose kit
   primitives and may add inline styles, but those styles must also use tokens.
5. **Brand identity is theme-agnostic.** `--sos-brand-primary`, `--sos-brand-deep`
   and the gradients stay consistent across modes — they ARE the brand.
6. **Status hexes change per theme.** Light mode uses deeper greens/reds/blues
   for AAA contrast on white; dark mode uses brighter ones. `--sos-status-*`
   handles this — never reach for the underlying hex.

---

## What every contributor needs to know

### How the theme switch works

```
app/layout.tsx (root)
   └─ <ThemeProvider>
         └─ writes data-theme="light|dark" on <html>
               ↓
         tokens.css      (--color-*, --sales-*, --status-*)
         sales-os.css    (--sos-*)
              both flip on the same data-theme attribute
              ↓
         every component, every workspace, themed identically
```

There is **no theme prop**, **no className-based theming**, **no per-component
flag**, **no per-shell provider**. A component does not know which theme it
is in — by design.

To read or set the theme imperatively:

```tsx
import { useTheme } from '@/components/layout/ThemeProvider';

const { theme, toggleTheme, setTheme, isHydrating } = useTheme();
```

To render a switch:

```tsx
import { ThemeToggle } from '@/components/layout/ThemeToggle';

<ThemeToggle />            // 38px icon button (matches topbar style)
<ThemeToggle size="sm" />  // small chip with label
```

### How to add a new visual surface

1. Open `styles/sales-os.css`.
2. Decide which token category the value belongs to (see `Token catalogue`
   below). If it fits an existing token, use that token instead.
3. If it needs a new token, add it to **both** the `:root` (light) block and
   the `:root[data-theme='dark']` (dark) block in `sales-os.css` with
   appropriate values.
4. Reference it in your component as `var(--sos-foo)` or
   `style={{ background: 'var(--sos-foo)' }}`.
5. Switch themes with the topbar toggle and verify both look right.

### When you can use raw hex

Only inside the token blocks themselves, and only for **brand identity** values
(brand-primary, brand-deep, accent gradient stops). Status colours go through
`--sos-status-{tone}` and theme-flip there. Raw hex anywhere else is a bug.

---

## Token catalogue

### Backgrounds (page + glass surfaces)

| Token | Use |
|---|---|
| `--sos-bg-app` / `--sos-bg-deep` / `--sos-bg-elevated` | Page backdrops |
| `--sos-bg-glass-top` / `--sos-bg-glass-bottom` | `GlassCard` default |
| `--sos-bg-glass-strong-top` / `--sos-bg-glass-strong-bottom` | `GlassCard variant="strong"` |
| `--sos-bg-glass-soft-top` / `--sos-bg-glass-soft-bottom` | `GlassCard variant="soft"` |
| `--sos-bg-input` / `--sos-bg-input-focus` | Form inputs (idle / focus) |
| `--sos-bg-banner` | `sos-banner` default |
| `--sos-bg-dropzone` | Upload dropzone default |
| `--sos-bg-row-top/bottom` / `--sos-bg-row-hover-*` | List rows + hover state |
| `--sos-bg-actionbar-top/bottom` | Sticky action bars |
| `--sos-bg-secondary-hover` | Hover for secondary buttons |
| `--sos-bg-topbar-icon-hover` | Hover for topbar icon buttons |
| `--sos-bg-overlay` | Modal / drawer backdrop |

### Surface tiers (white-tint inset surfaces inside cards)

| Token | Dark | Light | Use |
|---|---|---|---|
| `--sos-surface-1` | white 3% | slate 2.5% | Sub-tile rest, file rows |
| `--sos-surface-2` | white 4% | slate 4% | Hover state for surface-1 / inset KBD |
| `--sos-surface-3` | white 6% | slate 6% | Tab hover, ghost button hover, focus halos |
| `--sos-surface-4` | white 8% | slate 8% | Stronger inset (rarely needed) |
| `--sos-surface-tint-on-accent` | white 16% | white 32% | Inset border on top of dark/coloured fill (e.g. brand button border) |
| `--sos-surface-progress-track` | white 6% | slate 6% | Progress bar track, conic-gradient remainder |
| `--sos-surface-tab-count` / `-on` | white 8% / black 18% | slate 6% / white 28% | Tab counter chip BG (idle / on) |

**Decision tree for picking a surface tier:**

- Is this a hover state? → use the next tier up (1→2 or 2→3).
- Is it a focus halo / glow ring? → `--sos-surface-2` or `-3`.
- Is it just a faint inset block? → `--sos-surface-1`.

### Text

| Token | Hierarchy |
|---|---|
| `--sos-text-primary` | Headings, primary content |
| `--sos-text-secondary` | Body, descriptions, paragraph copy |
| `--sos-text-muted` | Labels, captions, hints |
| `--sos-text-faint` | Eyebrows, microcopy, disabled |
| `--sos-text-on-accent` | Text **on** brand gradient (button, badge) |
| `--sos-text-on-success/danger/warm` | Text on filled status buttons |

Never hardcode `#fff` or `#000` for text. Even on coloured fills, use
`--sos-text-on-accent` because in light mode the accent fill might require a
different text colour.

### Status (success / warning / danger / info / violet / cyan / pink / neutral)

Each status tone has three tokens:

```
--sos-status-{tone}        — the saturated colour for text/icons/buttons
--sos-status-{tone}-soft   — the tinted background fill (~12-18% alpha)
--sos-status-{tone}-border — the border on a soft fill (~32% alpha)
```

**Always use the trio together for a status surface.** Example:

```tsx
style={{
  background: 'var(--sos-status-success-soft)',
  color: 'var(--sos-status-success)',
  border: '1px solid var(--sos-status-success-border)',
}}
```

### Brand

| Token | Use |
|---|---|
| `--sos-brand-primary` / `-strong` | Brand link / highlight colour |
| `--sos-brand-primary-soft` / `-border` | Brand-tinted backgrounds and borders |
| `--sos-brand-accent` / `-soft` / `-border` | Warm accent (gold) — pair / contrast tone |
| `--sos-brand-gradient` | Primary CTA fill, active sidebar avatar |
| `--sos-brand-warm-gradient` | Warm-variant button (rare) |
| `--sos-brand-deep` | Dark navy used in avatar gradient terminus — same in both themes (brand identity) |

### Borders

| Token | Strength |
|---|---|
| `--sos-border-subtle` | Very faint (sub-tile dividers) |
| `--sos-border` | Default card / input border |
| `--sos-border-strong` | Hover / emphasis border |
| `--sos-border-accent` | Focus ring colour |
| `--sos-divider` | Horizontal/vertical dividers between sections |

### Shadows

| Token | Use |
|---|---|
| `--sos-shadow-xs/sm/md/lg` | Generic elevation tiers |
| `--sos-shadow-glass` | The signature glass card shadow |
| `--sos-shadow-glass-hover` | Hover for `sos-glass-hover` |
| `--sos-shadow-glow` / `-hover` | Brand-tinted glow (primary CTA, active avatar) |
| `--sos-shadow-warm` | Warm-tinted glow |
| `--sos-shadow-button-success/danger` | Filled status button drop shadows |
| `--sos-shadow-nav-active` / `-glow` | Sidebar active state shadows |

### Avatar gradients

| Token | Use |
|---|---|
| `--sos-brand-gradient` | Active avatar (primary identity) |
| `--sos-avatar-muted-gradient` | Past / inactive avatars (slate). Lighter slate in light mode. |
| `--sos-avatar-danger-gradient` | Overdue / alarm avatars. Same red in both themes. |

### Sidebar

The sidebar has its own token block (`--sos-sidebar-*`) because its gradient
inverts more strongly between modes than other surfaces:

```
--sos-sidebar-bg-top / -bottom         page-deep gradient (navy ↔ cream)
--sos-sidebar-text / -strong / -muted  text hierarchy on sidebar
--sos-sidebar-line                      separator
--sos-sidebar-active-bg / -bg-strong   active item background
--sos-sidebar-hover                     hover background
--sos-sidebar-icon-bg                   nav icon idle background
--sos-sidebar-progress-bg               in-sidebar progress track
--sos-sidebar-panel-top / -bottom       resource panel gradient stops
--sos-sidebar-glow-1 / -2               radial decoration glows
```

Inside sidebar JSX, **always use `--sos-sidebar-*` tokens, not generic
`--sos-text-*` or `--sos-surface-*`.** The sidebar's text colour does not
follow the page text hierarchy in either theme.

### Backdrops (page-level decoration)

| Token | Use |
|---|---|
| `--sos-backdrop-1/2/3` | Three-radial-glow backdrop layered behind every page |
| `--sos-backdrop-base` | Linear page gradient (app → deep) |
| `--sos-backdrop-glow-1/2` | Inner glow radials inside `.sos-shell::before` |

Light mode keeps these intentionally faint — strong glows wash out white.

---

## How light-mode glassmorphism works

The same `.sos-glass` class produces both looks:

**Dark mode**
- Surface: navy at 72% / 46% top→bottom
- Border: blue-white at 18% alpha
- Backdrop blur: 28px + 160% saturation
- Shadow: black at 50% (deep) + 6% white inset (top edge sheen)
- Strong radial glows in the page backdrop reinforce depth

**Light mode**
- Surface: white at 86% / 62% top→bottom (still translucent so the warm
  off-white page backdrop tints the surface)
- Border: slate at 10% alpha
- Backdrop blur: same 28px (the frosted feel survives)
- Shadow: slate at 6-8% (much softer) + 60% white inset for the top sheen
- Backdrop glows reduced to 4-8% so the white surface stays clean

The "premium glass" feeling carries because the **structure** is identical:
translucent surface + blur + soft border + subtle shadow + inset highlight on
the top edge. Only the colour values flip.

---

## Page-level rules

### Inline `style={{}}` is allowed

Pages are not required to use only utility classes — `style={{}}` is fine for
one-off layout. But every value inside that style must be a token reference:

✅ `style={{ background: 'var(--sos-surface-1)' }}`
✅ ``style={{ border: `1px solid ${someToneVar}` }}``
✅ ``style={{ background: `linear-gradient(135deg, ${stageColour}, var(--sos-brand-deep))` }}``
❌ `style={{ background: 'rgb(255 255 255 / 0.04)' }}`
❌ `style={{ background: '#0c2155' }}`
❌ `style={{ boxShadow: '0 18px 38px rgb(56 195 232 / 0.22)' }}`

The third example is acceptable because `stageColour` is a **domain function**
(stage → vivid hex) and `--sos-brand-deep` is a brand-identity token. Stage is
not a theme concept — a "Payment" stage is the same green idea in both modes.

### Hover handlers

Hover transitions via `onMouseOver` / `onMouseOut` are common in pages.
Always restore through tokens:

```tsx
onMouseOver={(e) => {
  e.currentTarget.style.background = 'var(--sos-surface-3)';
}}
onMouseOut={(e) => {
  e.currentTarget.style.background = 'var(--sos-surface-1)';
}}
```

Prefer pure-CSS hover via a shared class when possible — but inline
mouse-handlers stay token-pure if you have to use them.

### `color-mix` is fine

`color-mix(in srgb, var(--sos-status-success) 18%, transparent)` is an
acceptable pattern when you need a one-off tint and don't want to mint a new
token. The base colour MUST be a token (`var(--sos-...)`), not a hex.

---

## Checklist for new components and pages

Before opening a PR with new sales-workspace UI:

- [ ] Searched the file for `rgb(`, `rgba(`, `#xxx`, `linear-gradient(135deg, #` —
      zero matches in style props.
- [ ] All status-tinted surfaces use the `--sos-status-{tone} / -soft / -border`
      trio.
- [ ] No hardcoded shadow strings — all use `--sos-shadow-*`.
- [ ] No hardcoded text colours — all use `--sos-text-*`.
- [ ] Toggled to light mode via the topbar sun/moon and visually inspected.
- [ ] No hydration warning in the dev console (the provider only swaps the
      attribute after mount, so SSR matches the default theme).

---

## When NOT to add a new token

- "I need a slightly different shade for this one button." → Pick the closest
  existing surface tier instead. Pixel-perfect uniqueness is not worth the
  extra surface area.
- "I want a third theme variant." → Talk to the team first. The two-theme
  invariant is load-bearing for the localStorage / aria layout.
- "I want a status colour that doesn't fit the existing tones." → Reuse the
  closest tone. The 9 status tones (success/warning/danger/info/violet/cyan/
  pink/neutral/accent) cover every situation seen so far.

---

## What this system explicitly does NOT do

- It does not auto-flip on `prefers-color-scheme` after first load. The user's
  explicit choice persists in localStorage and beats the system preference.
- It does not theme third-party components. If you embed a non-`sos-*`
  component, wrap it or restyle it with tokens.
- It does not handle high-contrast / accessibility modes beyond what the AAA
  status hexes already provide. If we add an a11y theme, it is a third
  attribute value, not a parallel system.

---

## File map

```
styles/tokens.css                       — legacy --color-*/--status-*/--sales-* tokens
                                          (light = :root, dark = [data-theme='dark'])
styles/sales-os.css                     — premium glass --sos-* tokens + .sos-* utility CSS
                                          (light = :root, dark = :root[data-theme='dark'])
styles/THEME.md                         — this file (rules)

components/layout/ThemeProvider.tsx     — central provider (wraps <body>, owns
                                          data-theme on <html>, persists to
                                          tafsheen-theme localStorage)
components/layout/ThemeToggle.tsx       — single sun/moon button used by every shell

app/layout.tsx                          — <ThemeProvider> wraps every route
components/layout/EmployeeShell.tsx     — sales workspace shell (consumes useTheme)
components/layout/AdminShell.tsx        — admin workspace shell
components/layout/AppShell.tsx          — auth / partner / client shells
```

**Where tokens live**: `styles/tokens.css` and `styles/sales-os.css` only.
**Where the provider lives**: `components/layout/ThemeProvider.tsx` only.
**Where the toggle lives**: `components/layout/ThemeToggle.tsx` only.

Touch theming infrastructure here, never anywhere else.

## Deprecated systems (gone — for reference)

The following older systems used to live in this codebase and have been
removed. If you find documentation or PR references to them, they are stale.

| System | Status |
|---|---|
| `--sv-*` tokens + `.sv-*` classes (older sales v1) | **Removed.** Login was the last consumer; migrated to `--sos-*` / `.sos-*`. |
| `--sales-*` tokens + `.sales-shell` / `.sales-glass-*` classes | **Removed.** Used by `<AppShell variant="sales">`, `<Sidebar variant="sales">`, `<Topbar variant="sales">` — those variant branches are also removed since `EmployeeShell` replaced them. |
| `<SalesOsThemeProvider>` / `useSalesOsTheme()` / `<ThemeToggle from sales-v2>` | **Removed.** Replaced by the single central `ThemeProvider` + `useTheme` + `ThemeToggle` from `components/layout/`. |
| `data-sales-os="premium-dark\|premium-light"` attribute | **Removed.** Single `data-theme="light\|dark"` on `<html>`. |
| `localStorage` key `sv-theme` | **Removed.** Single key `tafsheen-theme`. |

If you spot any leftover reference to these, file or fix it — the grep audit
in this directory's history caught all the known ones, but new files might
re-introduce them.

## Module integration checklist

When you add a new workspace shell (e.g. a finance or HR module):

1. **Do not** create a new theme provider or context. Use the root one.
2. **Do not** add a new `data-*` attribute for theming. Use `data-theme`.
3. **Do not** invent a new token prefix. Either consume `--sos-*` (premium
   glass) or `--color-*` (flat utility). Pick one per surface.
4. **Do** add a `<ThemeToggle />` to the shell's topbar so users can switch
   from anywhere.
5. **Do** read `useTheme().theme` if the shell needs to render two layouts
   per theme (rare — most cases just consume tokens via CSS).
6. **Do** verify both light and dark by clicking the toggle in dev — never
   ship a shell tested in only one mode.

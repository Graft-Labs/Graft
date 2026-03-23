# Graft - UI Modernization & Feature Updates

## Overview
Modernize Graft to match the aesthetic of jace.ai with improved UX, new color scheme, and enhanced analytics.

---

## 1. Scan Issues Review
- [ ] Check issues found on Graft repo scan
- [ ] Verify correctness of detected issues
- [ ] No code changes needed - just review

---

## 2. Fix All Prompt Changes
**Current:** Toggle allows including medium/low issues
**Required:** Include ALL issues by default, remove toggle entirely

**Files to modify:**
- `app/scan/[id]/page.tsx`
  - Remove `includeAllSeverities` state
  - Remove toggle UI
  - Change default to include all issues
  - Update copy text to reflect all issues included

---

## 3. Remove Share & Export PDF Buttons
**Current:** Header has Share and Export PDF buttons
**Required:** Remove both buttons completely

**Files to modify:**
- `app/scan/[id]/page.tsx`
  - Remove Share button
  - Remove Export PDF button

---

## 4. Remove Upgrade Tab from Sidebar
**Current:** Sidebar has Upgrade/Pricing link
**Required:** Remove upgrade link from sidebar navigation

**Files to modify:**
- `components/layout/DashboardSidebar.tsx`
  - Remove "Upgrade" or "Pricing" nav item

---

## 5. Move Fix All Button to Page Body
**Current:** Fix All button is in the header
**Required:** Move Fix All button inside the page, near the issues list

**Files to modify:**
- `app/scan/[id]/page.tsx`
  - Remove from header
  - Add near issues list or as floating action button

---

## 6. Color Scheme Update

### New Colors
| Name | Hex | Usage |
|------|-----|-------|
| Primary | `#ffdc61` | Primary buttons, highlights, accents |
| Secondary | `#403718` | Dark backgrounds, cards |
| Accent | `#806e31` | Secondary accents, borders |

### CSS Variables to Update
```css
--primary: #ffdc61;
--secondary: #403718;
--accent: #806e31;
--primary-glow: rgba(255, 220, 97, 0.15);
--accent-glow: rgba(128, 110, 49, 0.15);
```

**Files to modify:**
- `app/globals.css` (or CSS variables file)
- All components using old colors

---

## 7. Font Updates

### New Fonts
- **Geist** (Geist_Variable-s) - Primary UI font
- **Gelica Light** (Gelica_Light-s) - Light/secondary text
- **Gelica Medium** (Gelica_Medium-s) - Medium/bold text

**Files to modify:**
- `app/layout.tsx` - Import fonts
- `app/globals.css` - Update font-family variables

---

## 8. Animations & Transitions

### Required Animations
- [ ] Page load animations (fade in, slide up)
- [ ] Button hover transitions (scale, color)
- [ ] Loading spinners for async operations
- [ ] Card hover effects
- [ ] Score counter animations
- [ ] Sidebar collapse/expand smooth transition

**Files to modify:**
- `app/globals.css` - Animation keyframes
- All component files - Add transition classes

---

## 9. Modern SaaS UI (Inspired by jace.ai)

### Design Principles
- Clean, minimal interface
- Generous whitespace
- Subtle gradients and glows
- Rounded corners (12-16px)
- Micro-interactions on hover
- Dark theme with warm accents

### Components to Update
- Dashboard cards
- Issue cards
- Score displays
- Navigation
- Buttons
- Forms

---

## 10. Posthog Analytics Setup

### MCP Installation
- [ ] Install Posthog MCP server
- [ ] Configure MCP with Posthog API key

### Tracking Events
Add tracking for:
- [ ] Page views
- [ ] Scan started
- [ ] Scan completed
- [ ] Fix All prompt copied
- [ ] Issue expanded
- [ ] Plan upgrade clicked
- [ ] Sign up / Login

### Files to Modify
- `app/layout.tsx` - Add Posthog provider
- `app/api/scan/route.ts` - Track scan events
- `app/scan/[id]/page.tsx` - Track fix prompt copies
- `app/auth/*` - Track auth events

---

## 11. Deployment
- [ ] Push changes to git
- [ ] Trigger Vercel deploy
- [ ] Test functionality

---

## Implementation Order

1. Create PLAN.md (this file)
2. Check scan issues
3. Update colors and fonts (foundational)
4. Fix All prompt changes
5. Remove buttons
6. Move Fix All
7. Remove Upgrade from sidebar
8. Add animations
9. Modernize UI
10. Setup Posthog
11. Deploy

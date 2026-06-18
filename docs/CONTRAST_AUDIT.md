# Color Contrast Audit (apps/web)

Status: H5 follow-up from the UI/UX review. WCAG 2.1 AA.

## Method

Ratios computed from the hex theme tokens in `apps/web/app/globals.css` (the production
Tailwind v4 theme; `apps/web` does not use the Clafoutis-generated files). Alpha-suffixed
Tailwind classes (e.g. `text-foreground/72`) are composited over their actual background
before measuring. AA thresholds: 4.5:1 for normal text, 3.0:1 for large text and non-text
UI (1.4.11).

This is a static token audit. It does not cover text rendered over images/gradients/video
or dynamic states. Recommend an automated `@axe-core/playwright` pass on the rendered pages
(see "Ongoing coverage") to catch what a static audit cannot enumerate.

## Active theme

The app is **dark-only today**. `:root` sets the dark palette with `color-scheme: dark`;
the light palette is gated by a `.light` class (`globals.css:65`) that nothing applies
(no theme toggle, no `next-themes` - confirmed by `app/layout.test.ts`). The light tokens
are therefore currently unreachable.

## Dark theme (default) - PASS

All real text meets AA. Tightest real cases noted.

| Pair | Ratio | Threshold | Verdict |
| --- | --- | --- | --- |
| foreground on background | 17.22 | 4.5 | PASS |
| muted-foreground on background | 10.08 | 4.5 | PASS |
| muted-foreground on card | 9.40 | 4.5 | PASS |
| muted-foreground on surface-2 | 8.59 | 4.5 | PASS |
| foreground/72 over background | 9.11 | 4.5 | PASS |
| muted-foreground/72 over background | 5.66 | 4.5 | PASS |
| primary text on background (links/labels) | 5.26 | 4.5 | PASS |
| primary text on card | 4.91 | 4.5 | PASS (tight) |
| primary-foreground on primary (button) | 5.08 | 4.5 | PASS |
| accent on background | 8.32 | 4.5 | PASS |
| destructive on background | 6.19 | 4.5 | PASS |
| destructive over destructive/10 | 5.52 | 4.5 | PASS |

Sub-threshold but acceptable (not a violation):

| Item | Ratio | Why it is acceptable |
| --- | --- | --- |
| `primary/15` giant footer wordmark over background | 1.18 | Decorative, `aria-hidden="true"` - exempt from 1.4.3 (conveys no information). |
| `border/58` aesthetic separators over background | 1.21 | 1.4.11 applies only to borders needed to identify/operate a control. These are decorative separators; component boundaries also rely on fill/shadow. Optional polish: strengthen the border on focusable inputs if relied on alone. |

## Light theme (`.light`, currently unreachable) - LATENT FAILURES

Fix these before wiring up a light mode. Suggested target hexes preserve the brand hue and
clear AA; confirm visually with design.

| Pair | Current | Threshold | Verdict | Suggested fix |
| --- | --- | --- | --- | --- |
| primary text on background | 4.20 | 4.5 | FAIL | darken `--primary` `#b55c70` -> ~`#a83f59` (>=4.5 on bg and for white-on-primary) |
| primary text on card | 4.41 | 4.5 | FAIL | same as above |
| primary-foreground on primary (button) | 4.41 | 4.5 | FAIL | darker `--primary` raises white-on-primary above 4.5 |
| accent on background | 3.69 | 4.5 | FAIL | darken `--accent` `#508c7b` -> ~`#3f7567` for accent-as-text (or only use accent as a fill, never as small text) |
| muted-foreground/72 over background | 3.21 | 4.5 | FAIL | avoid `/72` on `--muted-foreground` in light mode, or darken `--muted-foreground` `#675f60` -> ~`#585152` |

Note: `--success` and `--warning`/`--info` were not exhaustively tabled; re-run the script
below against them when enabling light mode.

## Reproduce

The ratios above were produced with a small Node script (sRGB relative luminance per WCAG,
alpha compositing for `/NN` classes). Re-run it after any token change:

```
node -e '<contrast script>'   # see the review history; tokens live in app/globals.css
```

## Ongoing coverage (recommended)

Add an automated check so contrast is verified on real rendered pages, not just tokens:

- Add `@axe-core/playwright` and assert no `color-contrast` violations on `/`, `/tasks`,
  `/tasks/[id]`, `/agents`, `/dashboard`, and the create-task form in an e2e spec
  (mirror `e2e/ui-regression.spec.ts`). This catches text-over-image/gradient cases and
  any new low-contrast usage as the UI evolves.

## Summary

- Dark theme (shipping): compliant. No code change required.
- Light theme: unreachable today; fix the five token pairs above before enabling it.
- Decorative wordmark is correctly `aria-hidden`; subtle borders are an aesthetic choice,
  optional to strengthen on inputs.

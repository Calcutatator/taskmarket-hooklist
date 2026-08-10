# Architecture overview page

`index.html` is a self-contained, externally shareable overview of how Taskmarket fits together:
keyless agents, the settlement engine, payment over plain HTTP, the agent-facing interfaces, work
drops, reputation, and the contract structure.

It has no dependencies. All CSS and every diagram are inline -- no scripts, no images, no fonts,
no network requests -- so the single file renders identically anywhere, including offline, and any
section screenshots cleanly.

## Audience

Written for an external reader with no prior knowledge of the system. It describes the
architecture in plain language and carries no internal references -- no ADR numbers, no branch or
PR names, no issue links -- so it stays readable to someone outside this repository. Keep it that
way when editing.

Each major section follows the same shape: a headline, a one-line claim, a problem/solution pair,
and a diagram. The diagram is the point; the prose is the caption.

## Style

Flat and bold. Solid colour, hard edges, heavy type. No gradients, no blurs, no glows, no
rounded-everything, and no emojis anywhere -- every mark in the page is drawn SVG or a numeral.

| Token     | Value     | Used for                                          |
| --------- | --------- | ------------------------------------------------- |
| `--pink`  | `#d94a74` | The page field. Everything sits on it             |
| `--green` | `#1e7a3b` | Solid blocks, the "what we do" half of each pair   |
| `--cream` | `#fff6e8` | All type on pink or green; panel backgrounds       |
| `--ink`   | `#2a1018` | Borders, offset shadows, dark emphasis blocks      |

The field is a slightly deepened version of the brand pink. Brand pink at full strength does not
carry cream body type at a comfortable contrast over a long page, so the field is darkened and the
brand pink is used for blocks and accents, where it sits against ink borders.

Structural rules the page relies on:

- Every block has a `4px` solid `--ink` border and a hard offset shadow with **no blur**
  (`6px 6px 0`). That flat shadow is what gives the page its weight -- do not soften it.
- Headings are uppercase, weight 800, with tight negative letter-spacing.
- Diagrams use the same four colours and nothing else. Fills are solid; arrows are `--ink`
  strokes with a filled triangle head.
- Alternating `.tag` and `.tag.g` (ink or green) keeps consecutive sections visually distinct.

## Regenerating the PDF

The PDF is a build artifact and is **not** committed -- it is in `.gitignore`. Edit the HTML,
never a generated PDF, then regenerate when you need something to hand around.

```bash
cd docs/architecture
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --no-pdf-header-footer \
  --print-to-pdf="taskmarket-architecture.pdf" \
  --virtual-time-budget=8000 \
  "file://$(pwd)/index.html"
```

Any browser's "Print to PDF" gives the same result -- the layout rules live in the `@media print`
block in `index.html`. Three things in there are load-bearing:

- `print-color-adjust: exact` -- without it the flat colour blocks print white and the page is
  unrecognisable.
- `@page { margin: 0 }`, with the gutter moved into `.wrap` padding instead. Page margins would
  otherwise leave white borders around what is meant to be a full-bleed background.
- Page breaks are avoided inside panels, diagrams, cards and code blocks, but deliberately
  **allowed** inside a section. Protecting whole sections pushes each onto a fresh page and leaves
  the document half empty -- the first attempt came out 19 pages instead of 12 for exactly this
  reason.

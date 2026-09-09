# LLMKit accessibility

Last reviewed: 2026-08-13

LLMKit targets WCAG 2.2 AA for the public website where it is practical. This is a target, not a
certification or a claim that every route currently conforms.

## Current controls

- Public pages use native links, buttons, headings, navigation, main, and footer landmarks.
- A keyboard skip link moves focus to the main content.
- Public interactive controls receive a visible focus indicator.
- The mobile navigation button exposes its expanded state and controlled menu.
- Installation choices use native buttons with an announced pressed state instead of incomplete ARIA
  tab semantics.
- The animated logo and ambient signal effects stop under `prefers-reduced-motion: reduce`.
- Informative images and diagrams provide text alternatives. Decorative graphics are hidden from the
  accessibility tree.
- Status and availability messages include text; color is not their only meaning.

## Verification

The public homepage, documentation, pricing, calculator, provider, MCP, and recovery routes must be
checked at desktop and narrow widths before an accessibility claim is updated. The minimum check is:

1. Inspect the browser accessibility tree for landmarks, heading order, names, and text alternatives.
2. Traverse every interactive control without a mouse and verify order, operation, and visible focus.
3. Verify the page remains usable at 200 percent zoom and a narrow viewport without hidden content.
4. Verify reduced-motion mode removes nonessential animation.
5. Check ordinary text contrast against its rendered background.

The 2026-08-13 production baseline exposed navigation, main, footer, headings, native controls, and
image alternatives in the browser accessibility tree. It also found no skip link, no explicit public
focus style, incomplete mobile-menu state, incomplete quickstart tab semantics, and low-contrast
small secondary text.

The same-day local production build was then checked on `/`, `/docs`, `/mcp`, `/pricing`,
`/compare`, `/providers/openai`, and `/service-restoring`. Each route exposed navigation and main
landmarks, one level-one heading, and the skip link. At a 375 CSS pixel content width, none of the
seven routes produced page-level horizontal overflow. Home, documentation, and calculator layouts
were also inspected visually at that width. The skip link received a visible two-pixel focus outline,
and the mobile navigation control exposed its closed state and controlled-menu relationship. Source
contracts verify the open-state transition, keyboard-native button semantics, and reduced-motion
rules. The browser test client could not dispatch an activation inside its scaled iframe, so this run
does not claim an executed mobile-menu activation or exact browser-zoom test.

No manual NVDA, VoiceOver, Narrator, or equivalent screen-reader run is recorded yet. Exact browser
zoom, reduced-motion emulation, contrast measurement, and a complete keyboard traversal also remain
open. Until those checks are executed, LLMKit does not claim screen-reader validation or full WCAG
conformance.

## Language scope

The current interface and documentation are English-only and do not have a localization framework.
Internationalization is therefore an acknowledged OpenSSF SHOULD gap, not N/A. Reassess when a
second user-facing locale or contributor need justifies the maintenance cost.

Report an accessibility defect through the public
[GitHub issue tracker](https://github.com/smigolsmigol/llmkit/issues). Include the route, viewport,
input method or assistive technology, expected behavior, and observed behavior.

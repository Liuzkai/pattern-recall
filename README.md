# Pattern Recall

**English** | [简体中文](README.zh-CN.md)

A tool for recalling 3×3 Android unlock patterns from the clues you remember. Specify dots, pattern length, endpoints, and connection rules to explore every matching pattern, then dismiss candidates that do not look familiar. All calculations run locally in your browser.

[Open the live app](https://liuzkai.github.io/pattern-recall/)

## Features

- Filter by required dots, excluded dots, a length range, and optional start and end dots.
- Independently exclude long diagonal moves and long horizontal or vertical moves.
- Practice drawing with a mouse, touch, or keyboard, with optional dot numbers.
- Browse candidates, dismiss individual patterns, hide dismissed results, and track the remaining count.
- Inspect drawing order, replay patterns, copy their sequences, and export candidates as CSV.
- Use a responsive dark interface with cream serif headings, terracotta accents, and no backend or runtime dependencies.
- On phones, jump between clues, results, and practice with a sticky navigation bar and larger touch controls.
- Switch between 14 interface languages, with English as the first-visit default and support for right-to-left text.

## Local development

Requires Node.js 20 or later. No dependency installation is needed.

```bash
git clone https://github.com/Liuzkai/pattern-recall.git
cd pattern-recall
npm run dev
```

Open [http://127.0.0.1:5173/](http://127.0.0.1:5173/). Refresh the page after editing HTML, CSS, or JavaScript. To use another port:

```bash
npm run dev -- --port 5174
```

## GitHub Pages

Live site: [Pattern Recall](https://liuzkai.github.io/pattern-recall/).

GitHub Pages publishes the root of the `main` branch. Pushing to `main` automatically updates the site; no Node.js server is needed in production. The root `.nojekyll` file ensures that HTML, CSS, JavaScript, and the Worker are published as static files. The `dist/` build output also includes this file.

## Usage

The interface defaults to English. Use the language selector in the header to choose English, Simplified Chinese, Traditional Chinese, Japanese, Korean, French, Spanish, Hindi, Arabic, Bengali, Portuguese, Russian, Urdu, or Indonesian. Your language preference is saved locally; switching languages preserves clues, exclusions, pagination, and the practice drawing. Arabic and Urdu use right-to-left text, while the physical dot layout and sequence direction remain unchanged.

Labels, validation messages, pattern details, accessibility labels, and CSV column headers follow the selected language. An export keeps the language selected when it started.

Inspired by [Webhound](https://www.webhound.ai/?ref=landingfolio), the theme uses a warm near-black background, cream serif headings, terracotta accents, and flat panels with thin borders. Instrument Serif is self-hosted under the [SIL Open Font License](src/fonts/OFL.txt), with system font fallbacks.

On screens up to 760 px wide, panels stack vertically and a sticky navigation bar links to clues, results, and practice. Finding patterns automatically brings the results into view. Candidate cards adapt to the available width, and the detail dialog scrolls within the screen. The practice link opens a collapsed pad without clearing the drawing.

**Practice drawing** (`试画九宫格`) is a separate card at the bottom of the left column, below the clue panel. It opens by default and can be collapsed. Drag with a mouse or finger, click dots individually, or use Tab followed by Enter/Space. Turn off **Show numbers** (`显示数字`) to draw with plain dots. This preserves your drawing and is independent of the number toggle for candidate patterns. Green marks the start, purple marks the end, and the sequence appears below. Use **Undo one dot** (`撤回一点`) or **Clear drawing** (`清空试画`) to try again.

The practice pad follows the two independent crossing filters. When a type of long move is allowed, drawing follows Android's automatic midpoint insertion. Dots crossed during a fast drag are added in order. Changing the rules preserves your drawing and shows a warning if it contains a connection that is now excluded.

1. Choose **Must include** (`必须包含`) or **Must exclude** (`一定排除`), then click dots in the clue grid. Click a selected dot again to cancel it. **Clear** (`清除`) returns a dot to an unknown state.
2. **Exclude long diagonals** (`排除斜线跨格`) and **Exclude long straight lines** (`排除直线跨格`) are both enabled by default and can be changed independently. Long diagonals include `1→8`, `1→6`, and `1→9`; long straight moves include `1→7` and `1→3`. Adjacent diagonals such as `1→5` remain allowed. Disable both filters to use the standard Android rules. Click **Find possible patterns** (`列举可能的图案`) after changing clues or rules.
3. Set the minimum and maximum number of dots. The default is 4–9; the supported range is 1–9. Changing one bound past the other updates both bounds to keep the range valid.
4. Optionally select the first and last dots. **Not sure** (`不确定`) leaves an endpoint unrestricted. A chosen endpoint is automatically required; a conflict with an excluded dot prompts you to adjust the clues.
5. Click **Find possible patterns** (`列举可能的图案`). Results show 24 patterns per page. Filter by length, move between pages, or enter a page number directly.
6. Click a pattern to inspect its direction, full sequence, and animated replay. You can also copy the sequence.
7. Each card has a separate **Exclude this pattern** (`排除此图案`) button. Excluded cards dim, and the button changes to **Excluded · Restore** (`已排除 · 恢复`). Excluding a card does not open its details.
8. Enable **Hide excluded** (`隐藏已排除`) to remove dismissed patterns from the list, total count, and pagination. Disable it to restore individual patterns, or choose **Restore all** (`恢复全部`). The **Remaining** (`剩余`) badge always counts undismissed patterns within the selected length filter, whether dismissed cards are visible or hidden.
9. **Export all** (`导出全部`) downloads a CSV containing the candidate number, length, and dot sequence. The length tabs affect browsing only. If **Hide excluded** is enabled, the export omits dismissed patterns but includes every other matching length.

Green dots mark starting points, purple outlines mark endpoints, and arrows indicate the direction of each connection. Required dots do not have a prescribed order.

Dismissals are stored by the actual dot sequence and survive pagination, length changes, clue changes, and regeneration. Reloading the page or choosing **Restore all** clears them. **Reset** (`重置`) restores the clue inputs only. Card numbers come from the full candidate set for the current query and stay stable when patterns are hidden or filtered by length.

## Pattern rules

The enumerator follows Android's rules for valid dot sequences:

- Dots are numbered by row: `1 2 3 / 4 5 6 / 7 8 9`.
- Each dot can be used at most once. Order matters.
- A direct connection crossing a midpoint requires that midpoint to have already been used. For example, `1→3` cannot be the first recorded connection, but `2→1→3` is valid.
- Android drawing automatically inserts an unused midpoint. Drawing `1→3` therefore records `1→2→3`. This tool enumerates the recorded sequences.
- The default 4–9 range matches the usual Android minimum length. Lengths 1–3 let you explore partial memories and generally cannot be used as Android unlock patterns.
- A fixed start must be the first dot, and a fixed end must be the last. They cannot be the same in a pattern with multiple dots; a single-dot pattern may use the same start and end.
- Rotations, reflections, and reversed sequences are not merged. A reversed sequence is listed only if it independently satisfies the rules.

A move is considered **long** if its row or column changes by more than one. Long moves within a row or column are straight; all other long moves are diagonal. Enabling both exclusion filters allows only the eight neighboring directions. A previously visited midpoint does not relax these exclusions.

With no other restrictions, the four filter combinations produce these totals for lengths 4–9:

| Exclude long diagonals | Exclude long straight moves | Patterns |
| --- | --- | ---: |
| No | No | 389,112 |
| No | Yes | 189,744 |
| Yes | No | 29,312 |
| Yes | Yes | 10,096 |

With both exclusions disabled and no other restrictions, there are **389,112** Android patterns of length 4–9. Counts by length:

| Dots | Patterns |
| --- | ---: |
| 1 | 9 |
| 2 | 56 |
| 3 | 320 |
| 4 | 1,624 |
| 5 | 7,152 |
| 6 | 26,016 |
| 7 | 72,912 |
| 8 | 140,704 |
| 9 | 140,704 |

Rule references: AOSP [LockPatternView](https://android.googlesource.com/platform/frameworks/base/+/HEAD/core/java/com/android/internal/widget/LockPatternView.java) and [LockPatternUtils](https://android.googlesource.com/platform/frameworks/base/+/HEAD/core/java/com/android/internal/widget/LockPatternUtils.java).

## Verification and build

```bash
npm test
npm run build
npm run preview
```

The build copies static assets into `dist/`, ready for any static host. Serve the app over HTTP: opening `index.html` directly with a `file://` URL does not reliably support ES modules and Workers.

## Project structure

```text
index.html             Page markup
favicon.svg            Site icon
src/app.js             Clues, dismissals, filters, pagination, details, CSV export
src/patterns.js         Pattern enumeration and pagination
src/connections.js     Classification and independent rules for long moves
src/worker.js          Background computation and result transfer
src/render.js          SVG patterns and direction arrows
src/sketch.js          Practice sequences, gesture hit detection, drawing controls
src/styles.css         Responsive layout and base styles
src/theme.css          Warm dark theme, practice card, responsive and RTL layout
src/mobile.css         Phone layout, touch targets, safe areas, and quick navigation
src/fonts/             Self-hosted Instrument Serif fonts and SIL OFL license
src/i18n.js            Language selection, formatting, and text updates
src/locales/           Complete message catalogs for 14 interface languages
scripts/serve.mjs      Static development server with no dependencies
scripts/build.mjs      Static asset build
.nojekyll              GitHub Pages static publishing marker
tests/                 Algorithm and interaction checks
```

Enumeration uses depth-first search with bitmask pruning. Results are stored in a `Uint32Array` and transferred from a Worker. Only one page is rendered at a time. CSV exports are generated in chunks to avoid blocking interaction. Clues and patterns are processed locally, are not uploaded, and are not persisted between page reloads. Only language and theme preferences are saved in local storage; the app still works when storage is unavailable.

In browsers that support WebMCP, the page optionally registers an `enumerate_pattern_candidates` tool using the same state and actions as the interface. `excludeLongDiagonal` and `excludeLongStraight` control the two crossing exclusions independently. The legacy `adjacentOnly` option defaults to `true` and provides a shared default for both filters; explicit individual options take precedence. Browsers without WebMCP can use the app normally.

## Pixel console theme

The header theme selector switches between **Pixel console** (the default for new visits) and **Warm editorial**. The console uses ink, parchment, vermilion and teal with square dot geometry, pixel headings, flat keys, consistent result cards, dialogs and mobile navigation. Silkscreen is self-hosted under the SIL OFL in `src/fonts/Silkscreen-OFL.txt`; non-Latin text uses readable system fallbacks.

Only language and theme preferences are persisted. `pattern-recall.theme` is restored before first paint, with a safe fallback when storage is blocked. Switching themes preserves clues, drawings, dismissed candidates, pagination and open details. Theme styles live in `src/console.css`, initialization in `src/theme.js`.

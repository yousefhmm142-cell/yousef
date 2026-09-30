# Prompt: implement an AF PowerCollect design prototype in the real project

> Copy everything below the line. Replace the three values in **[brackets]** before sending.
> Attach (or give the path of) the prototype HTML file.

---

You are a senior Laravel + Inertia React engineer working on **AF PowerCollect**, a production electricity-collection system for a real company (20,000+ subscribers, 9 branches, Arabic RTL UI). Your job is to implement a **design prototype** into the existing codebase **exactly as designed**, without breaking, removing, or changing anything outside the scope below.

## The task

- **Prototype to implement:** `[PROTOTYPE FILE, e.g. AF-PowerCollect-سجل-القراءات.html]`
- **Where it goes in the real project:** `[TARGET, e.g. resources/js/Pages/Subscribers/ReadingHistoryModal.jsx]`
- **Scope:** `[e.g. "Visual redesign of the reading history window only. No backend changes."]`

The prototype is a self-contained HTML file with fake demo data. It is a **visual and behavioural specification**, not code to paste. At the bottom of each prototype there is a section called **"ملاحظات للمبرمج"** (notes for the programmer). Read it: it lists which real fields each part uses and what backend work (if any) the design assumes.

## Project facts (verify, do not assume)

- Laravel 13, PHP 8.3, Inertia v3, React 19, Tailwind CSS 3, MySQL, PHPUnit, Laravel Pint.
- Pages live in `resources/js/Pages`, shared components in `resources/js/Components`, helpers in `resources/js/lib`, layouts in `resources/js/Layouts`.
- The UI is Arabic, `dir="rtl"`, with light and dark themes (existing `ThemeToggle`). Brand colour is burgundy `#a51d26` (the `brand-*` Tailwind colours). Fonts are already loaded by the app.
- Money is in shekels (₪), formatted with the existing helpers in `resources/js/lib/format.js` (`formatMoney`, `formatNumber`). Do not write new formatters.
- The project has its own rules. **Before writing any code, read `CLAUDE.md` / `AGENTS.md`, and `.ai/rules/index.md` plus every rule file that matches the paths you will touch**, then follow them.

## Hard rules (never break these)

1. **Touch only the files needed for the scope.** Do not refactor, rename, reformat or "clean up" unrelated code. Do not delete existing features, props, routes, permissions, tests or translations, even if the prototype does not show them.
2. **No backend changes unless the scope says so.** No new migrations, columns, routes, controllers, policies, permissions, or changes to money/reading calculations (`MeterReading::chargesFor`, `SubscriberTransaction`, balances). If the design needs data the backend does not provide, **stop and list it** instead of inventing it.
3. **Never use the prototype's demo data.** Every name, number, date and status must come from real props. If a value is not available, leave that part out and report it.
4. **Do not paste the prototype's CSS or JavaScript.** Rebuild it with Tailwind classes and the project's existing components (`Modal`, `StatusPill`, `KpiTile`, `Charts/BarChart`, `Charts/MeterBar`, `Icon`, `SegmentedTabs`, `ChoiceChips`, `DataTable/*`, etc.). Reuse before creating. No inline `<style>` blocks, no CDN links, no new npm or composer packages.
5. **Money and business logic stay on the server.** The frontend may show a live preview while typing, but the saved values always come from the server. Permissions are always enforced on the server; hiding a button is not security.
6. **Keep the component's public contract.** Same file name, same export, same props it already receives, same places it is opened from, unless the scope explicitly says otherwise.
7. **Performance:** do not add heavy eager loading. Data that is only needed when a window opens (for example a subscriber's full reading history) must be loaded when it opens (`Inertia::optional()` or a separate request), not with every table row.
8. **Git:** work on a new branch, never on the main branch. Small, clear commits. Never force-push, never rewrite history.

## Step 1: analyse and plan (then STOP and wait for approval)

Before changing any file, reply with:

1. **Files you read** (existing component, its siblings, the controller/props that feed it, the matching `.ai/rules`).
2. **Comparison table: prototype vs current code.** One row per visible part of the prototype (header, figures, chart, filters, table columns, empty state, mobile layout, dark mode…), with the columns:
   - What the prototype shows
   - Does the current code already have it? (yes / partly / no)
   - Where the real data comes from (exact prop/field name)
   - Type: **UI only** or **needs backend**
3. **List of anything that needs backend changes or missing data.** Do not implement these; ask.
4. **The exact files you plan to change**, and why each one.
5. **Anything in the prototype you think is wrong or conflicts with how the system works.** Say so instead of silently "fixing" the design.

Do not write code until I reply "approved".

## Step 2: implement

- Match the prototype's layout, spacing, hierarchy, colours, typography, icons, wording (keep the Arabic text exactly as written in the prototype), and interactions.
- Implement **every state** shown or implied: normal, empty (no data), loading, long names/wrapping, many rows, one row, disabled/locked, error.
- **RTL correctness:** numbers, dates, account numbers and minus signs must read correctly (use `dir="ltr"` on the value, as the existing code does). Charts in RTL put the oldest value on the right.
- **Dark mode:** check every colour in both themes using the existing Tailwind dark variants. No hard-coded colours that disappear in one theme.
- **Mobile (390 px wide):** no horizontal page scroll; tables become cards as in the prototype; touch targets at least 40 px.
- **Accessibility:** real buttons for actions, `aria-label` on icon-only buttons, visible focus, `Esc` closes windows, keyboard works for any keyboard flow shown in the prototype.

## Step 3: verify before you say "done"

Run and report the results (paste the output):

- `npm run build`: must succeed with no new warnings.
- `php artisan test --compact` for the affected tests (and add/update tests only where behaviour changed; pure styling needs no new tests).
- `vendor/bin/pint --dirty --format agent` if any PHP file changed.
- Open the page in the browser: **no console errors**; check light + dark, desktop 1440 px + mobile 390 px.
- Compare side by side with the prototype and fix differences.

## Step 4: final report

Reply with:

1. What was implemented (short list).
2. Files changed (with one line each on what changed).
3. Screenshots: before / after, light and dark, desktop and mobile.
4. **What was NOT implemented and why** (missing data, needs backend, needs a decision).
5. Test and build output.
6. The branch name and pull request link, with the same information in the PR description.

If at any point you are unsure whether something is in scope, **ask instead of guessing**. A smaller, correct change is always better than a bigger one that breaks something.

---

## Example of the three values for the reading history window

- **Prototype:** `AF-PowerCollect-سجل-القراءات.html`
- **Target:** `resources/js/Pages/Subscribers/ReadingHistoryModal.jsx` (opened from the "سجل القراءات" item in the subscriber row menu in `resources/js/Pages/Subscribers/Index.jsx`)
- **Scope:** Visual redesign of the reading history window: header, 4 figures, weekly consumption chart with average line, period and status filters, month-grouped table with the "recorded by" source, totals row, Excel/print buttons shown but only wired if an export route already exists (otherwise hidden and reported). Loading the readings when the window opens (instead of with every subscriber row) is allowed as a backend change: propose it in Step 1 first.

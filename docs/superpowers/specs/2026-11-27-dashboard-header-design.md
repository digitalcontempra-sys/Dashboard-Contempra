# Main Dashboard header: clock, personal cards, area menu

Date: 2026-11-27. Status: approved by the owner.

## Intent and why

The Main Dashboard is where each person starts the day. The owner wants it to:

- ground the day (big clock with day and date);
- push each person to act on what is theirs (three personal cards);
- shorten trips to the Production Board (area menu with counts);
- read with clear hierarchy, in the existing Apple-style light glass look, not a flat page.

## Layout (fixed by the owner)

The owner's Photoshop composition is the reference and must be matched. Ask the owner to attach it in the chat if it is not there.

Desktop, top to bottom:

1. **Row 1.**
   - Left: "Main Dashboard" (large, bold) and "N work orders" below.
   - Right: sync status pill, **New Docket** (brand red) and **New Task Card**.
2. **Row 2, four blocks side by side:**
   1. **Clock + selectors column.**
      - The clock in a glass panel: `8:00 AM | FRIDAY Nov 27, 2026`. The time is large and bold. The weekday is uppercase, in brand red, bold. The date is regular.
      - Below it, the scope selector `All dockets | My Dockets | My List`.
      - Below that, `Active | On Hold | History`. Both keep the current segmented style: red active pill for scope, black for status.
   2. **Overdue task cards** (amber veil).
   3. **At risk** (red veil).
   4. **Waiting on you** (blue veil).
   5. **Areas · Open board**: an area-button grid in 3 columns, inside a glass panel.
3. **Row 3.** Section chips (All, Rush / Today, Upcoming, New Orders, No Due Date, Daily Complete): unchanged.
4. **Row 4.** Search + account-manager filter, then tiles: unchanged.

### Visual style

- Keep the existing tokens and glass. Only add tokens where needed: primitives → semantic → component, in `src/web/index.css`.
- **Personal cards:**
  - Each has a soft diagonal veil gradient in its hue: amber, red or blue.
  - Thin border, soft shadow, ~20px radius.
  - Icon + title in the hue's dark ink.
  - The number is very large and bold in the darkest ink.
  - The detail line is in the medium ink.
  - Hover lifts slightly. The whole card is a link.
- **Area buttons:**
  - The area tint as background (existing `--area-*` tokens).
  - Name on the left, count right-aligned and bold, in the area ink (`--area-*-ink`, AA).
  - Compact, low visual weight (tertiary menu).
- AA contrast in light and dark. Cards stay readable in dark mode: use the dark-mode veil variants, do not force light.
- `prefers-reduced-motion` respected.

### Responsive

- **Tablet (< 1280px):**
  - The clock + selectors column takes a full row.
  - The 3 personal cards go in one row below it.
  - The Areas panel goes below them, full width, with 4–6 columns.
- **Phone (375px):**
  1. title;
  2. clock;
  3. the 3 cards, compact, stacked or in a 3-column grid of small cards (no sideways scroll);
  4. selectors;
  5. section chips;
  6. the Areas panel, last and collapsible (collapsed by default, remembered in localStorage).
- No horizontal scroll at any width.

## The three personal cards

All three are **personal**: they always count the signed-in user's items, whatever scope selector is active.

"My dockets" = dockets whose column J matches one of my user codes (the existing My Dockets rule, `user_codes`).

| Card | Counts | Detail line | Click |
|---|---|---|---|
| **Overdue task cards** | Task Cards **sent to me** by others (not notes to self), `status = 'open'`, and either created more than 24 h ago or with a due date before today (Winnipeg) | `Oldest: <n> days · from <first name>` (or `All caught up` at 0) | My Cards with the Task cards filter |
| **At risk** | My active dockets (not COMP, not cancelled, not on hold) that are overdue or due today (Winnipeg dates, the same rule as the Rush/Today bucket) | `<a> overdue · <b> due today` | Main Dashboard: My Dockets + Active, filtered to these dockets (a `risk` filter; show a dismissible "At risk" chip) |
| **Waiting on you** | (a) my New Orders untouched for more than 2 days (`created_at`/last edit older than 48 h); (b) dockets where my creator card waits for an approval (`waiting_*` stage); (c) cards of mine that were sent back to me and are active | `<a> new orders · <b> approvals · <c> sent back` (omit zero parts) | Main Dashboard filtered to those dockets (a `waiting` filter, with a dismissible "Waiting on you" chip) |

- A zero count shows `0` in a calm state, with the veil kept but lighter. Never hide the card.
- Staff do not see the Main Dashboard, so these cards are for managers and admins. If a Staff user ever reaches it, the same rules apply to their own items.

## Area menu

- One button per production area, in `ROLE_ORDER` order: Design, Print Roll, Print FB, Laminate, Contour Cut, Liquid Lam, Colex, Finishing, Install, Measure, Sub Contract.
- **Count** = active cards in that area across the whole shop: the same rule the Production Board uses for its column counts. `General` is not shown.
- **Click:** opens `/production?area=<roleId>`. The Production Board scrolls that column into view and highlights it briefly. Add support for the `area` query parameter.
- Title: `Areas · Open board`.

## Clock

- Winnipeg time (`America/Winnipeg`). Format: `h:mm AM`, then `|`, then the weekday uppercase, then `MMM d, yyyy`.
- Updates on the minute boundary with one timer. No seconds.
- It is not a `<time>` live region: avoid screen-reader chatter. Give it an `aria-label` with the full date.

## Data

- **One new light endpoint:** `GET /api/dashboard/summary` returns:

  ```
  { overdueTasks: { count, oldestDays, oldestFrom },
    atRisk: { overdue, dueToday },
    waiting: { newOrders, approvals, sentBack },
    areas: [{ roleId, count }] }
  ```

- It is fetched with the dashboard list, with the same 30 s refetch. No new polling loop.
- The `risk` and `waiting` filters live in the existing `/api/dockets` list as query parameters. They use the same rules as the counts, shared helpers in one place.
- Free-plan friendly: a few aggregate queries per call. Check `rows_read` on the list with the new filters.
- No Google Sheet changes. No migration expected unless an index is needed.

## Non-goals

- No charts, trends or efficiency metrics: "done today" was rejected as misleading.
- No change to tiles, chips, search or the editor.
- No new notifications.

## Builder notes

- Build on the current `Dashboard.tsx`. Extract `DashboardHeader`, `PersonalCard`, `AreaMenu` and `Clock` components.
- Tests first:
  - pure rules: Winnipeg dates, the 24 h / 48 h thresholds;
  - worker: summary counts and filters, with My Dockets codes, notes to self excluded, other people's items excluded;
  - web: layout roles and labels, links, the collapsible areas on phone, the clock format with fake timers.
- Check in the local preview at 1440, 1024 and 375 px, light and dark.

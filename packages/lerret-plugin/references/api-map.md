# API map — every screen, the APIs it calls, and what each API does

Use this when someone asks to map, document, plan or visualise an app's APIs, backend, endpoints, or which screen calls what.

The result is one Lerret page that a non-developer can read:

```
Gateway ──▶ Area card ──────────────────────────────▶ API cards
(how every   (each screen: screenshot on the left,     (who can call it, input, output,
 request      the APIs it calls on the right — when     rules, every place that uses it)
 comes in)    it opens, and for each button/pop-up)
```

Plus an **overview** card (how to read it, roles, services, stored data) and a **gaps** card (what's missing, risky or broken).

The two files beside this guide do the mechanical parts:
- `api-map/screen-area.jsx` — the area card (screenshot beside its APIs). Copy it to `.lerret/_lib/screen-area.jsx`.
- `api-map/build-map.mjs` — draws the one diagram (`_index.mmd`) and checks nothing is missing or duplicated.

## Ground rules

1. **Facts only.** Every line comes from the code or the running app. If you didn't check it, don't write it; put it under gaps as "not checked" instead.
2. **Business words, no code.** Cards say who, what goes in, what comes out, and the rules — in plain sentences. No snippets, types or file names in cards (the overview may name a stored collection).
3. **One place per fact.** One diagram. Each API card hangs off exactly one area. Screenshots live only on area cards. Never build a second view of the same thing.
4. **Never lose information when restructuring.** Back up the folder first, then diff the result against it and count items before and after.
5. **Short and plain.** Short sentences, everyday words, bold only the action or the label.

## Folder layout

```
.lerret/
  _lib/screen-area.jsx            ← copied from this guide (hidden from the canvas: "_" folder)
  _shots/<screen>.jpeg            ← screenshots (hidden from the canvas)
  <Page name>/                    ← e.g. "Backend plan"
    00-overview.md
    09-gaps.md
    Screens and APIs/
      _index.mmd                  ← written by build-map.mjs
      gateway.md
      area-<id>.jsx + area-<id>.data.json    ← one per area
      <api-id>.md                 ← one per API path
```

## Steps

### 1. List every API
Read the route files. One card per **path**; all its methods go on that card. Card id = the path in kebab case without `/api`: `/api/projects/{pid}/people` → `projects-pid-people`.

### 2. Write each API card
Read the handler and everything it calls before writing. Format:

```markdown
# Project people
`/api/projects/{pid}/people`

Adds people to a project by email, changes their role, or takes them off.

## `POST` — Add people
- **Who:** Signed in (browser). Owner or editor.
- **Input:** `pid` (path). Body: `emails` (1–100 email addresses, required); `role` ("editor" or "viewer", required).
- **Output:** `{ added, already, waiting, project }` — how many joined now, were already in, or wait to sign up.
- **Rules:**
  - The project's owner must be on Pro.
  - Up to 40 add requests an hour per person.

## `DELETE` — Remove someone, or leave
- **Who:** …
- **Input:** …
- **Output:** `{ ok }`.
- **Rules:** …

## Used by
- **People pop-up (project page `/projects/[id]`)** — Add by email, change roles, remove, leave

**Gap:** Something wrong or missing in this API, in one sentence.
```

- Line 2 is always the path in backticks — `build-map.mjs` reads it.
- **Who:** who may call it (anyone / signed in / role / plan / staff / another app) and how they prove it.
- **Input:** where each field comes from (path, query, body), what it is, limits, required or not.
- **Output:** the shape, then what it means in words.
- **Rules:** limits, side effects, what's refused and why. One line, or a list when there are several.
- **Used by:** every screen, pop-up, background job or outside caller that uses it, and why. "No screen calls this" is a valid answer.
- **Gap:** only if real; also list it in the gaps card.

### 3. List every screen and what it calls
From the app's routes. For each screen, read its code: what it calls **when it opens**, and what each **button, form or pop-up** calls. Mark each screen:
- **Live** — real backend
- **Static** — no backend needed
- **Stub** — the screen exists, but the data is fake or empty

### 4. Take screenshots
- Run the app locally against **seeded test data** (an emulator or local database). Never screenshot production with real people's data.
- Use separate browser contexts for signed out and signed in (and staff, if there is one).
- One shot per screen, and one per pop-up or state worth showing. 1440px wide; scroll to the part that matters.
- Save as `.lerret/_shots/<kebab-name>.jpeg`.

### 5. Group screens into areas
Number the areas in the order a user meets them: `1 · Get in`, `2 · …`. The last area is `N · No screen`: webhooks, scheduled jobs, APIs no screen calls, hidden screens, and things every page does in the background. Calls an outside app makes on its own go in the area of the screen where the user connects that app.

### 6. Write each area card
`area-<id>.jsx` (only the size changes per card):

```jsx
import { ScreenArea } from '../../_lib/screen-area.jsx';

export const meta = {
  dimensions: { width: 1800, height: 2200 }, // height: measured in step 8
  label: '​', // blank on purpose: the card's own heading names the area (an empty label falls back to the file name)
  tags: ['api-map'],
  propsSchema: {
    title: { type: 'string', default: '3 · Projects', description: 'Area title at the top.' },
  },
};

export default function Projects(props) {
  return <ScreenArea id="projects" {...props} />;
}
```

`area-<id>.data.json` holds all the text:

```json
{
  "title": "3 · Projects",
  "apis": ["projects", "projects-pid", "projects-pid-people"],
  "links": [["mcp", "mcp-tools"]],
  "screens": [
    {
      "name": "Project page",
      "where": "`/projects/[id]` · Live",
      "about": "One client project: its blueprints, comments and people.",
      "views": [
        {
          "label": "",
          "shot": "project",
          "groups": [
            { "title": "When it opens", "items": [
              "`GET /api/projects/{pid}` — the project and its people"
            ]},
            { "title": "When you…", "items": [
              "**Edit name or description** → `PATCH /api/projects/{pid}`",
              "**Comment, reply, delete** → `POST` / `PATCH` / `DELETE /api/projects/{pid}/comments`"
            ]},
            { "title": "Rules", "items": [
              "Adding people needs the owner on Pro."
            ]}
          ]
        },
        {
          "label": "People pop-up",
          "shot": "project-people",
          "groups": [
            { "title": "", "items": [
              "**Add by email, change role, remove** → `POST` / `PATCH` / `DELETE /api/projects/{pid}/people`",
              "**After a change** → `GET /api/projects/{pid}` — reloads"
            ]}
          ]
        }
      ]
    }
  ]
}
```

- `where`: the screen's URL in backticks, then ` · ` and the status.
- `views`: the first view is the screen itself (`label` empty); each pop-up or state is another view with its own `label` and `shot`. A view without a `shot` shows text only.
- Group titles: `When it opens`, `When you…`, then `Rules` or `Notes` when needed.
- Item text, which the card renders for you:
  - `` `GET /path` `` → a coloured method chip and the path. Several methods: `` `POST` / `PATCH` / `DELETE /path` ``.
  - `**Action**` → bold. Name the button or action as the user sees it.
  - ` → ` splits an item into two columns: what the user does | the API.
  - ` — ` adds what comes back or why.
- `apis`: the API cards this area **owns**. An API used in several areas is owned by the one whose screen is its main user. The other areas still name it in their items, and its card's **Used by** lists every place.
- `links` (optional): a card that hangs off another card instead of off the area, e.g. a tool list hanging off the API that serves it.

### 7. Write the gateway, overview and gaps cards
**`gateway.md`** — how every request comes in:
- A small `flowchart LR` mermaid: internet → site → `/api/…` → who is calling? → allowed? → data and outside services.
- **Who can call**: each kind of caller, how they prove it, and where it works.
- **When it says no**: each error code and what it means.
- **Other ways in**: webhooks, scheduled jobs, plain files.

**`00-overview.md`** — "start here": how the page is laid out (gateway → area cards → API cards, read left to right), the status key, who is who (roles and plans), the services used, and what's stored.

**`09-gaps.md`** — lists only, grouped as: **Screens with no backend**, **Risks**, **APIs no screen calls**, **Small bugs**. Every `**Gap:**` line from an API card appears here too.

### 8. Build the map, size the cards, check
1. `node "<this guide's folder>/api-map/build-map.mjs" "<page>/Screens and APIs"` — writes `_index.mmd` (gateway → areas → their API cards, each area in an untitled box) and fails if an API card is owned by no area or by two, if an owned card is missing, or if an area never mentions a path it owns. Fix and re-run until it passes.
2. Open the studio, then measure each area's real height in the page (each card's content has `data-area`):
   ```js
   [...document.querySelectorAll('[data-area]')].map(e => [e.dataset.area, Math.ceil(e.getBoundingClientRect().height / (e.getBoundingClientRect().width / 1800))])
   ```
   Set each card's `meta.dimensions.height` to its number.
3. Check in the studio: every screenshot loads, nothing is cut off at the bottom, the diagram reads left to right.

## Lerret things that will bite you
- Markdown cards **don't render tables**. Use lists: `**Label** — text`.
- An image in a markdown card: `![](/@lerret-project/_shots/name.jpeg)`. In a `.jsx` file: `new URL('../_shots/name.jpeg', import.meta.url).href` (the bundled card already does this).
- Folders starting with `_` don't appear on the canvas, and files in them can be imported. That's why the component and screenshots live in `_lib/` and `_shots/`.
- `_index.mmd` node ids are file names without the extension. `subgraph id[" "]` draws an untitled box; `~~~` is an invisible link.
- An asset's label can't be empty (it falls back to the file name), so use `'​'` when the card already has its own heading.
- Card sizes are fixed by `meta.dimensions`: re-measure after adding text or screens.

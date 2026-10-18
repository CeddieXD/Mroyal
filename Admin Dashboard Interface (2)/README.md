# Mango Royal Admin (lite)

Lightweight admin dashboard, matching the `mango-royal-kitchen-lite` / `mango-royal-pos-lite`
style (plain HTML/CSS/JS, no build step). Drop-in sibling of the POS and Kitchen apps.

## Views

- **Dashboard** — sales analytics line chart, top items bar chart, today's operations metrics, weather widget, and a bottom-center Royal Insights capsule with an expanding analytics chat
- **Transactions** — searchable/filterable table with expandable order details, discount &amp; void reasons
- **Menu Management** — category-filtered grid with add / edit / delete / toggle-availability (in memory)
- **Reports** — basic sales, product performance table, sales by hour + weekly line chart, insights
- **Users** — user list with role pills, add / edit / delete / activate (in memory)
- **Settings** — report, notifications, security, backup, appearance panels

## Run

Open `index.html` — any static server works. Simplest:

```bash
npx serve .
```

## Stack

- Plain HTML/CSS/JS, no framework, no bundler.
- One external dep: [Chart.js](https://www.chartjs.org/) via CDN.
- Dashboard, transaction, and menu data are loaded from the local backend; users and menu edits are session-only.
- Royal Insights answers supported questions from the current dashboard metrics and does not call an external AI service.

## Files

- `index.html` — single page, sidebar nav toggles view sections
- `css/admin.css` — hand-written theme (mango/orange accents, dark sidebar)
- `js/app.js` — all data + view rendering + modals
- PNG assets at the project root are used for menu item images and the brand logo.

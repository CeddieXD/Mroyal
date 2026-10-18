# Mango Royal Admin (lite)

Lightweight admin dashboard, matching the `mango-royal-kitchen-lite` / `mango-royal-pos-lite`
style (plain HTML/CSS/JS, no build step). Drop-in sibling of the POS and Kitchen apps.

## Views

- **Dashboard** — sales analytics line chart, top items bar chart, today's operations metrics, weather widget, and a bottom-center Royal Insights capsule with an expanding analytics chat
- **Transactions** — searchable/filterable table with expandable order details, discount &amp; void reasons
- **Menu Management** — category-filtered grid with add / edit / delete / toggle-availability
- **Reports** — basic sales, product performance table, sales by hour + weekly line chart, insights
- **Users** — user list with role pills, add / edit / delete / activate (in memory)
- **Settings** — report, notifications, security, backup, appearance panels

## Run

Follow the repository [setup and staff sign-in guide](../README.md) to configure
the shared backend, start the apps, use the Admin demo account, and connect from
a tablet. Admin requires the `admin` account and has its own browser session.

Run this app using any static server. Simplest:

```bash
npx serve .
```

The authenticated backend must also be running for the dashboard, live menu
editing, and image uploads. In the menu editor, choose a PNG, JPG, or WebP
image (up to 10 MB); it is stored in
`mango-royal-kiosk/public/assets/img`, the shared image directory served at
`/images/` to the admin, kiosk, and POS.

## Stack

- Plain HTML/CSS/JS, no framework, no bundler.
- One external dep: [Chart.js](https://www.chartjs.org/) via CDN.
- Dashboard, transaction, and menu data are loaded from the local backend; user management is session-only.
- Royal Insights answers supported questions from the current dashboard metrics and does not call an external AI service.

## Files

- `index.html` — single page, sidebar nav toggles view sections
- `css/admin.css` — hand-written theme (mango/orange accents, dark sidebar)
- `js/app.js` — all data + view rendering + modals
- PNG assets at the project root are used for menu item images and the brand logo.

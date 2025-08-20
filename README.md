# Sophia Insights — Global Oil & Gas Production Dashboard

This dashboard loads **real, always-up-to-date data** directly from Our World in Data (based on the Energy Institute Statistical Review) and the U.S. EIA. No setup required — just open `index.html` or deploy to GitHub Pages.

## Data sources
- Oil production by country (TWh): Our World in Data (EI Statistical Review).
- Oil consumption by country (TWh): Our World in Data (EI Statistical Review).
- Proven oil reserves (tonnes): Our World in Data.
- Crude oil price series (USD per m³): Our World in Data based on S&P Global Platts.

The page fetches these CSVs at runtime from OWID's public Grapher endpoints.

## How to publish on GitHub Pages
1. Create a repository (e.g., `oil-global-dashboard`) and upload all files.
2. Settings → Pages → Deploy from branch → `main` → root. Save.
3. Open your Pages URL. That's it.

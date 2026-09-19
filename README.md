# Authorization Intelligence Dashboard

A React + Recharts dashboard built around the 120,000-row authorization dataset.

## Run locally

1. Install Node.js 20+.
2. Open this folder in a terminal.
3. Run:
   ```bash
   npm install
   npm run dev
   ```
4. Open the local Vite URL shown in the terminal.

## Deploy

Push this folder to GitHub and import the repository into Vercel. No server is required for the dashboard itself.

## AI Insights

The UI includes a persistent AI Insights drawer. To connect the existing AI API framework, create a `.env` file:

```env
VITE_AI_INSIGHTS_URL=https://your-existing-endpoint
```

The frontend sends a compact context object containing the active view, filters, KPIs, trends, and top drivers. If no endpoint is configured, the dashboard uses a local deterministic insight generator so the UI remains functional.

## Data

The real 120,000-row dataset is in `public/authorization_data.csv`.


## Data source

The dashboard now reads its data directly from the supplied Google Sheet rather than bundling the 120k-row CSV:

`https://docs.google.com/spreadsheets/d/1tadSeuYgEliS2cOkH-9uR31NUDS7Mt2PXjiB_-1EW44/export?format=csv`

### Google Sheets setup

For the browser to retrieve the data, the Google Sheet needs to be accessible to the dashboard. In Google Sheets, use **Share** and set the appropriate access (for a demo, "Anyone with the link" as Viewer), or publish the sheet if required by your organization's settings.

The dashboard does not require the CSV to be uploaded to GitHub.

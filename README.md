# Authorization Intelligence Dashboard

React + Vite dashboard using Google Sheets as the data source and an AI Insights drawer.

## Data source
The app reads the public CSV export of the configured Google Sheet from `src/dataSource.js`.

## AI
The AI Insights drawer calls the existing `payments-ai-insights.bgohrani.workers.dev` endpoint and supports:
- Gemini 2.5 Flash-Lite
- GPT-OSS 20B via Groq
- OpenRouter Free

## Vercel
Use:
- Framework preset: Vite
- Root directory: `./`
- Build command: `npm run build`
- Output directory: `dist`
- Install command: `npm install`

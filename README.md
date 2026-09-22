# Authorization Intelligence Dashboard

A React/Vite fintech analytics dashboard for exploring synthetic payment authorization, authentication, fraud and chargeback data, with a context-aware AI analysis engine.

The application combines:

- React + Vite frontend
- JavaScript
- Recharts
- CSS responsive UI
- Google Sheets as the data source
- Cloudflare Workers as the AI/API gateway
- Multiple AI provider integrations
- GitHub for source control
- Vercel for frontend deployment

## Architecture

```text
                         GitHub
                           |
                           v
                     +-----------+
                     |  Vercel   |
                     | React/Vite|
                     +-----+-----+
                           |
                           v
                    +-------------+
                    |   Browser   |
                    |             |
                    | Dashboard   |
                    | Filters     |
                    | Charts      |
                    | AI UI       |
                    +--+-------+--+
                       |       |
              Data     |       | AI request
                       v       v
                +---------+  +------------------+
                | Google  |  | Cloudflare Worker|
                | Sheets  |  | JavaScript API   |
                +---------+  +--------+---------+
                                      |
                          +-----------+-----------+
                          |           |           |
                          v           v           v
                       Gemini   Workers AI   HF/NVIDIA
```

The important architectural separation is that the frontend does not directly implement provider-specific AI integrations. The Cloudflare Worker acts as the AI gateway.

---

# Technology Stack

## Frontend

- React
- JavaScript
- Vite
- Recharts
- CSS
- HTML

## Data

- Google Sheets
- Google Visualization/CSV endpoint
- Client-side JavaScript data transformation
- React state and memoized derived calculations

## Backend/API

- Cloudflare Workers
- JavaScript
- HTTP `fetch`
- CORS handling
- Worker environment variables/secrets

## AI

The Worker contains integrations for multiple providers, including:

- Google Gemini
- Cloudflare Workers AI
- Hugging Face router models
- NVIDIA NIM / Nemotron

## Deployment

- GitHub
- Vercel
- Cloudflare Workers
- Google Sheets

---

# Application Architecture

The application can be understood as four layers.

## 1. Presentation layer

React renders:

- Navigation
- Sidebar/filter controls
- KPI cards
- Charts
- Tables
- Authentication analysis
- Fraud and chargeback analysis
- AI Analysis interface

## 2. State layer

React state controls:

- Selected filters
- Current dashboard section
- Filtered population
- AI analysis mode
- Selected model/provider
- User prompt
- AI generation/loading state
- AI output

## 3. Data-processing layer

JavaScript functions transform raw rows into the structures required by the dashboard.

Examples include:

- Approval calculations
- Decline calculations
- Transaction mix
- Authentication outcomes
- Fraud metrics
- Chargeback metrics
- Domestic vs. cross-border mix
- Monthly/time-series aggregations

`useMemo` is used for derived datasets where appropriate so that calculations are not unnecessarily repeated.

## 4. AI/API layer

The frontend sends an AI request to the Cloudflare Worker.

The Worker:

1. Receives the request.
2. Reads the selected provider/model.
3. Receives dashboard context.
4. Builds the analytical prompt.
5. Calls the selected AI provider.
6. Normalizes the provider response.
7. Returns the result to React.

---

# Frontend

The application is a single-page React application built with Vite.

React is responsible for keeping the dashboard state synchronized.

For example:

```text
User changes filter
       |
       v
React state updates
       |
       v
Filtered dataset changes
       |
       +---------> KPI calculations
       |
       +---------> Chart data
       |
       +---------> Tables
       |
       +---------> AI context
```

This means the AI analysis is tied to the same dashboard state the user is viewing.

## Recharts

Charts are rendered using Recharts.

Chart components consume JavaScript data structures produced from the currently filtered dataset.

This keeps the visualization layer connected to the application's calculation layer rather than using hard-coded chart values.

---

# Data Architecture

Google Sheets is used as the external data source.

The general flow is:

```text
Google Sheet
    |
    v
Google CSV / Visualization endpoint
    |
    v
Frontend fetch
    |
    v
CSV parsing / normalization
    |
    v
JavaScript records
    |
    +--> Filters
    +--> KPI calculations
    +--> Charts
    +--> AI context
```

A Google Sheets CSV endpoint follows this general pattern:

```text
https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/gviz/tq?tqx=out:csv
```

A specific tab can be requested using:

```text
https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/gviz/tq?tqx=out:csv&sheet=<SHEET_NAME>
```

Google Sheets is particularly useful for this implementation because the underlying synthetic dataset can be changed without modifying the React application.

The data layer can later be replaced by a database, API, data warehouse or object-storage service without requiring the visualization architecture to be redesigned.

---

# Filtering Architecture

The dashboard maintains a filtered transaction population.

Filters are applied before dashboard calculations and AI context generation.

Conceptually:

```text
Raw dataset
    |
    v
Active filters
    |
    v
Filtered population
    |
    +--> Overview
    +--> Authentication
    +--> Fraud & Chargebacks
    +--> AI context
```

This is particularly important for AI analysis.

If a user selects a particular issuer, country, channel or month, the AI should analyze that population rather than silently analyzing the complete dataset.

---

# AI Engine

The AI engine is designed as a contextual analytical engine rather than a standalone chatbot.

The core concept is:

```text
Dashboard state
      |
      v
Structured AI context
      |
      v
Cloudflare Worker
      |
      v
Analytical prompt
      |
      v
Selected LLM
      |
      v
Generated analysis
      |
      v
AI Insights UI
```

The AI receives relevant information from the current dashboard state.

Depending on the mode, this can include:

- Current section
- Active filters
- KPI values
- Trend data
- Decline-driver data
- Transaction mix
- Authentication data
- Fraud data
- Chargeback data
- Domestic/XB data
- User-defined question

The model therefore receives analytical context rather than the entire frontend application.

---

# AI Analysis Modes

## Whole Dashboard

The model receives dashboard-level context and is instructed to identify meaningful observations across the available analytical areas.

This can include authorization, authentication, transaction mix, decline drivers, fraud, chargebacks and domestic/cross-border performance.

## Current Section

The context is restricted to the section currently being viewed.

For example:

```text
Authentication tab
       |
       v
Authentication context
       |
       v
AI analysis
```

This keeps the model focused on the relevant subject.

## User Prompt

The user can ask a natural-language question.

Examples:

```text
Which decline reason changed the most?

Compare domestic and cross-border approval performance.

What should I investigate based on the current filtered population?
```

The user question is passed to the Worker together with the dashboard context.

---

# AI Request Flow

```text
User
 |
 | selects model / section / filters
 | optionally enters a question
 v
React
 |
 | constructs dashboardData
 v
Cloudflare Worker
 |
 | constructs prompt
 | selects provider
 v
AI Provider
 |
 | model inference
 v
Cloudflare Worker
 |
 | normalized response
 v
React
 |
 v
AI Insights panel
```

The frontend therefore does not need separate code for each AI provider's API format.

---

# Dashboard Context

A major part of the AI design is the creation of structured dashboard context.

Conceptually:

```javascript
{
  section: "Overview",

  filters: {
    issuer: "...",
    month: "...",
    channel: "..."
  },

  metrics: {
    approvalRate: "...",
    approvedAmount: "...",
    declineAmount: "..."
  },

  visualizations: [
    "Authorization trend",
    "Transaction mix",
    "Top decline drivers",
    "Domestic vs XB mix"
  ],

  domesticXBMix: [...]
}
```

The actual context varies according to the selected dashboard state.

The AI does not need the entire raw frontend source code. It receives the information required to reason about the current dashboard.

This keeps the AI request focused and makes the architecture easier to extend.

---

# Cloudflare Worker

The Cloudflare Worker is the serverless JavaScript API layer between the React application and AI providers.

Its basic structure is:

```javascript
export default {
  async fetch(request, env) {
    // CORS handling
    // Request parsing
    // Prompt construction
    // Provider selection
    // AI request
    // Response handling
  }
}
```

The Worker receives information such as:

```text
provider
model
dashboardData
userPrompt
analysisMode
```

It then determines how the request should be processed.

The Worker is intentionally separate from the frontend so provider credentials are not embedded into the React bundle.

---

# AI Provider Abstraction

The provider layer can be represented as:

```text
                 React
                   |
                   v
           Cloudflare Worker
                   |
        +----------+----------+
        |          |          |
        v          v          v
     Gemini   Workers AI   HF/NVIDIA
```

The frontend selects the desired provider/model.

The Worker translates that selection into the provider-specific API request.

This means the UI does not need to know whether the underlying request is:

- a Gemini REST API call
- a Cloudflare Workers AI invocation
- a Hugging Face router request
- an NVIDIA NIM request

The provider implementation stays inside the Worker.

---

# Gemini Integration

For Gemini, the Worker constructs the appropriate request and uses the configured Gemini API credential.

The credential remains server-side.

Conceptually:

```text
React
  |
  | dashboard context
  v
Worker
  |
  | Gemini API request
  | + Worker secret
  v
Gemini
```

---

# Cloudflare Workers AI

The Worker can also use models exposed through the Cloudflare Workers AI runtime.

This allows AI inference to be integrated directly with the Cloudflare execution environment.

The Worker can invoke the selected model through the Worker environment rather than requiring the frontend to communicate directly with the model.

---

# Hugging Face

The Worker includes support for Hugging Face router-based model APIs.

This provides another model-provider abstraction without requiring any changes to the dashboard's visualization or filter logic.

---

# NVIDIA NIM / Nemotron

The Worker also contains integration logic for NVIDIA's NIM/model-serving API infrastructure.

This allows the same dashboard AI interface to work with another provider through the same Worker architecture.

---

# AI Prompt Engineering

The Worker contains the main analytical prompt logic.

The prompt establishes how the model should reason about the dashboard.

Important instructions include:

## Use supplied dashboard data

The model is instructed to analyze the data supplied in the request.

## Do not invent numbers

The model should not manufacture metrics that are absent from the dashboard context.

## Quantify findings

When supported by the context, findings should use:

- Counts
- Amounts
- Percentages
- Percentage-point differences
- Trends
- Shares

## Distinguish observations from hypotheses

For example:

```text
Observed:
Approval rate declined from X% to Y%.

Potential explanation:
The change coincides with an increase in a particular decline category.
```

The model should not automatically convert the second statement into a causal claim.

## Respect dashboard scope

The prompt explicitly tells the model that the supplied context represents the current dashboard population.

## Section-specific reasoning

The Worker distinguishes between whole-dashboard and current-section analysis.

Authorization and authentication contexts are also treated separately where appropriate.

---

# AI Guardrails

The AI layer includes several analytical guardrails.

### No fabricated metrics

Numbers should come from supplied dashboard context.

### No unsupported causality

An observed relationship should not automatically be described as causal.

### Current-filter awareness

The model should analyze the currently selected population.

### Section awareness

The model should focus on the relevant dashboard section.

### Quantitative analysis

The model is encouraged to use actual dashboard values instead of vague statements.

### Fact vs. hypothesis

The output should distinguish what is directly observable from what may require additional investigation.

---

# User Prompt Interface

The AI prompt interface allows users to ask questions against the current dashboard state.

The important technical distinction is:

```text
Generic chatbot:
Question -> Model

This dashboard:
Dashboard state
     +
Filters
     +
Current section
     +
Question
     |
     v
   Model
```

The user therefore does not have to manually copy dashboard numbers into the AI prompt.

The application prepares the relevant context automatically.

---

# AI Output

The Worker returns a normalized response to the frontend.

The frontend then renders the generated analysis in the AI Insights panel.

The UI handles:

- Generation state
- Stop-generation state
- Model selection
- User prompts
- AI response rendering
- Structured analytical output

The AI interface is therefore part of the dashboard rather than a separate chatbot page.

---

# Security Model

The most important security principle is that AI provider credentials are not stored in frontend JavaScript.

Avoid:

```javascript
const API_KEY = "secret";
```

Instead:

```text
Browser
   |
   v
Cloudflare Worker
   |
   v
Worker secret
   |
   v
AI provider
```

The frontend only needs the Worker endpoint.

Provider credentials remain in the Worker environment.

The Worker also handles CORS and the provider-specific API calls.

---

# Deployment

## Frontend

The frontend is deployed to Vercel.

Typical Vercel configuration:

```text
Framework: Vite
Root Directory: ./
Build Command: npm run build
Output Directory: dist
Install Command: npm install
```

## Worker

The Cloudflare Worker is deployed separately.

The frontend communicates with the deployed Worker using HTTPS.

```text
Vercel frontend
       |
       | HTTPS POST
       v
Cloudflare Worker
       |
       v
AI providers
```

## GitHub

GitHub is used as the source-control layer.

A typical deployment flow is:

```text
Code change
    |
    v
GitHub commit
    |
    v
Vercel build
    |
    v
Production deployment
```

---

# Environment Variables / Secrets

Provider credentials should be configured in the Worker environment and never committed to GitHub.

The Worker implementation uses provider-specific environment bindings, including configured credentials for the supported AI services.

Examples of configured credential names include:

```text
gemini-api-key
groq-api-key
openrouter-api-key
```

The exact bindings should match the deployed Worker configuration.

If additional providers are enabled, their credentials should follow the same server-side secret pattern.

---

# Project Structure

A typical frontend structure is:

```text
project/
├── src/
│   ├── main.jsx
│   ├── components/
│   └── styles.css
├── public/
├── index.html
├── package.json
├── vite.config.js
└── README.md
```

The Cloudflare Worker is the separate serverless API/AI layer.

The exact repository structure can vary by branch.

---

# Local Development

Install dependencies:

```bash
npm install
```

Start the Vite development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

The production build is generated in:

```text
dist/
```

---

# Responsive Architecture

The dashboard uses responsive CSS media queries.

Desktop uses multi-column layouts:

```text
+----------------+---------------------------+
| Sidebar        | Dashboard                 |
|                |                           |
| Filters        | KPIs / Charts / Tables    |
+----------------+---------------------------+
```

On mobile, the interface collapses into a vertical layout:

```text
+-----------------------+
| Header                |
+-----------------------+
| Filters               |
+-----------------------+
| KPI                   |
+-----------------------+
| Chart                 |
+-----------------------+
| Chart                 |
+-----------------------+
| Chart                 |
+-----------------------+
| AI Insights           |
+-----------------------+
```

The CSS includes responsive handling for:

- Sidebar
- Filter groups
- KPI cards
- Charts
- Tables
- AI panel
- Horizontal overflow
- Narrow-screen layouts

---

# Performance

The application is designed to remain lightweight.

## Memoized calculations

Derived datasets can be calculated with `useMemo` so changes unrelated to a calculation do not unnecessarily recompute it.

## Client-side filtering

Filters can update the dashboard without requiring a backend query for every interaction.

## Focused AI context

Only relevant dashboard context is passed to the model.

This is preferable to sending the entire application or unnecessary raw data.

## Provider abstraction

Changing the AI provider does not require redesigning the frontend.

---

# Error Handling

The architecture has multiple potential failure points:

```text
Google Sheets
     |
     v
Data loading
     |
     v
React dashboard
     |
     v
Cloudflare Worker
     |
     v
AI provider
```

Examples include:

- Google Sheets unavailable
- Invalid data response
- Worker request failure
- Provider API failure
- Invalid model/provider selection
- AI generation failure

The Worker returns structured responses so the frontend can handle provider errors without needing to understand every provider's native API format.

---

# Extending the Dashboard

## Add a new filter

A filter can be added to the filter-group configuration.

The filtering architecture then allows the selected value to become part of the filtered population.

## Add a new metric

A derived metric can be calculated from the filtered dataset and then exposed to:

- KPI cards
- Charts
- Tables
- AI context

## Add a new chart

A new chart can consume a derived JavaScript dataset and be rendered through Recharts.

## Add AI context

A new analytical object can be added to the dashboard context.

Conceptually:

```javascript
dashboardData = {
  ...existingContext,
  newMetric: newMetricData
}
```

The Worker prompt can then define how the model should interpret it.

---

# Extending the AI Engine

The provider architecture allows additional AI providers to be added without redesigning the dashboard.

A new provider can follow the pattern:

```javascript
if (provider === "new-provider") {
    // build provider request
    // call provider API
    // extract model response
    // normalize response
}
```

New analysis modes can also be added.

Current conceptual modes:

```text
whole_dashboard
current_section
user_question
```

Possible future modes include:

```text
trend_analysis
issuer_analysis
merchant_analysis
risk_analysis
decline_analysis
```

The frontend and Worker can be extended independently.

---

# End-to-End AI Example

Suppose the user selects:

```text
Issuer: ABC
Country: UAE
Channel: Ecom
Month: 202609
```

and asks:

```text
Why is approval performance lower for this population?
```

The flow is:

```text
1. User changes filters
        |
2. React filters the dataset
        |
3. Dashboard recalculates KPIs/charts
        |
4. User enters question
        |
5. React creates dashboardData
        |
6. React sends dashboardData + question to Worker
        |
7. Worker builds analytical prompt
        |
8. Worker selects the requested model
        |
9. Provider performs inference
        |
10. Worker returns generated analysis
        |
11. React renders AI response
```

The model is therefore operating on the dashboard's current state rather than an unrelated static prompt.

---

# Design Principles

## Separation of concerns

The application separates:

```text
UI
Data
Filtering
AI orchestration
AI providers
Deployment
```

## Provider independence

The dashboard should not be tightly coupled to a single LLM provider.

## Context-aware AI

AI analysis should reflect the dashboard state.

## Server-side secrets

Provider credentials should remain outside the frontend.

## Reusable analytical context

The same dashboard context can support whole-dashboard analysis, section analysis and user questions.

## Lightweight infrastructure

The project avoids requiring a dedicated application server for the frontend.

---

# Live Application

**Dashboard:**  
https://auth-dashboard-3.vercel.app/

---

# High-Level System Summary

```text
                  ┌─────────────────────┐
                  │      GitHub         │
                  │ Source Control      │
                  └──────────┬──────────┘
                             |
                             v
                  ┌─────────────────────┐
                  │       Vercel        │
                  │ React + Vite        │
                  └──────────┬──────────┘
                             |
                             v
                  ┌─────────────────────┐
                  │      Browser        │
                  │                     │
                  │ Dashboard           │
                  │ Filters             │
                  │ Charts              │
                  │ AI Interface        │
                  └───────┬───────┬─────┘
                          |       |
                          |       |
                    Data  |       | AI Context
                          |       |
                          v       v
                  ┌──────────┐  ┌─────────────────────┐
                  │ Google   │  │ Cloudflare Worker   │
                  │ Sheets   │  │ JavaScript AI API   │
                  └──────────┘  └──────────┬──────────┘
                                           |
                          ┌────────────────┼────────────────┐
                          |                |                |
                          v                v                v
                       Gemini        Workers AI       HF / NVIDIA
```

The central technical design is:

**Google Sheets → React/Vite → filtered dashboard state → structured AI context → Cloudflare Worker → selected LLM → AI Insights**

This architecture keeps the frontend, data source, AI orchestration layer and model providers modular while allowing the AI engine to operate directly against the dashboard's current analytical context.

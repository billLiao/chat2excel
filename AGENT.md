# AI Agent Capabilities

This document describes the AI Agent capabilities of Chat2Excel.

## Agent Role

The AI in Chat2Excel acts as a **Data Analyst Agent**. It translates user intents into structured data operations.

## Capabilities

### 1. NL2SQL (Natural Language to SQL)
The agent analyzes the schema of imported Excel/CSV files and generates optimized DuckDB SQL queries based on user requests.

### 2. Visualization Recommendation
Beyond just querying data, the agent determines the most appropriate chart type (bar, line, pie, etc.) to represent the results.

### 3. Data Insights
The agent can provide summaries and identify patterns within the datasets.

## Integration

- **Model**: Compatible with OpenAI-style APIs (GPT-4o, Claude 3.5, DeepSeek, etc.).
- **Tools**: The agent has direct access to the DuckDB engine to execute queries and fetch schemas.

## Safety & Privacy
- All SQL execution is supervised by the local DuckDB instance.
- Only metadata (column names and samples) are sent to the LLM; the full dataset remains local.

export interface Tool {
    type: 'function';
    function: {
        name: string;
        description: string;
        parameters: object;
    };
}

export const QUERY_DATABASE_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'query_database',
        description: 'Execute a SQL query against the local DuckDB database to retrieve data. Use this tool when the user asks questions about the data in the tables.',
        parameters: {
            type: 'object',
            properties: {
                sql: {
                    type: 'string',
                    description: 'The SQL query to execute. Only SELECT statements are allowed.',
                },
            },
            required: ['sql'],
        },
    },
};

export const RENDER_CHART_TOOL: Tool = {
    type: 'function',
    function: {
        name: 'render_chart',
        description: 'Render a chart (bar, line, pie) using ECharts options. Use this tool when the user asks to visualize data. The output should be a valid Apache ECharts option object in JSON format.',
        parameters: {
            type: 'object',
            properties: {
                title: { type: 'string', description: 'Chart title' },
                chartType: { type: 'string', enum: ['bar', 'line', 'pie'], description: 'Type of chart' },
                explanation: { type: 'string', description: 'Brief explanation of what the chart shows' },
                option: {
                    type: 'string',
                    description: 'JSON stringified ECharts option object. Must include "series", "xAxis", "yAxis", "tooltip", etc. as required by ECharts.'
                }
            },
            required: ['title', 'chartType', 'option'],
        },
    },
};

export async function executeToolCall(toolName: string, args: any): Promise<string> {
    if (toolName === 'query_database') {
        try {
            console.log('Executing Tool SQL:', args.sql);
            const result = await window.api.db.executeSQL(args.sql);
            if (result.success) {
                // Handle BigInt serialization
                return JSON.stringify(result.data, (_, v) =>
                    typeof v === 'bigint' ? v.toString() : v
                    , 2);
            } else {
                return `Error executing SQL: ${result.error}`;
            }
        } catch (error: any) {
            return `Error executing SQL: ${error.message}`;
        }
    } else if (toolName === 'render_chart') {
        // For charting, the "Execution" is essentially just passing the config back to the UI.
        // The Agent loop will record this tool call.
        // The UI will detect this tool call in the history and render the chart.
        // So we just return a success message here, effectively "confirming" the chart is ready.
        return `Chart configuration generated for ${args.title}. UI should render it now.`;
    }
    return `Unknown tool: ${toolName}`;
}

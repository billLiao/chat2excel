import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { QUERY_DATABASE_TOOL, RENDER_CHART_TOOL, executeToolCall } from './tools';

export interface ChatMessage {
    id: string;
    role: 'user' | 'assistant' | 'system' | 'tool';
    content: string;
    tool_calls?: any[];
    name?: string;
    tool_call_id?: string;
    timestamp: number;
}

interface AgentConfig {
    apiKey: string;
    baseUrl: string;
    model: string;
    systemPrompt?: string;
}

export const DEFAULT_SYSTEM_PROMPT = "You are a data analysis assistant.";

export type OnUpdate = (messages: ChatMessage[]) => void;

export async function runAgent(
    messages: ChatMessage[],
    config: AgentConfig,
    onUpdate: OnUpdate,
    contextTables?: string[]
) {
    const client = new OpenAI({
        apiKey: config.apiKey,
        baseURL: config.baseUrl,
        dangerouslyAllowBrowser: true // Running in Electron Renderer (safe-ish for local app)
    });

    // Fetch table schema to inject into system prompt
    let schemaInfo = "";
    try {
        const tablesRes = await window.api.db.getTables();
        if (tablesRes.success && tablesRes.data) {
            // Filter by contextTables if defined and not empty
            const activeTables = (contextTables && contextTables.length > 0)
                ? tablesRes.data.filter(t => contextTables.includes(t.name))
                : tablesRes.data;

            const tableNames = activeTables.map(t => t.name);
            schemaInfo = `\n\nDatabase Tables available for analysis:\n${tableNames.join(', ')}`;

            // Fetch detailed schema for each table to reduce tool calls
            const schemas: string[] = [];
            for (const table of activeTables) {
                const colsRes = await window.api.db.getColumns(table.name);
                if (colsRes.success && colsRes.data) {
                    const colDefs = colsRes.data.map((c: any) =>
                        `- ${c.name} (${c.type}): ${c.description || 'No description'}`
                    ).join('\n');
                    schemas.push(`\nTable: ${table.name}\nDescription: ${table.description || 'N/A'}\nColumns:\n${colDefs}`);
                }
            }
            if (schemas.length > 0) {
                schemaInfo += `\n\n=== Table Schemas ===\n${schemas.join('\n')}\n=====================\n`;
            }

            schemaInfo += `\n\nIMPORTANT: Only analyze the tables listed above. The schema is provided above, so you generally DO NOT need to call "DESCRIBE table_name" unless strictly necessary.`;
        }
    } catch (e) {
        console.warn("Failed to fetch schema for system prompt", e);
    }

    const systemMessage: ChatMessage = {
        id: randomUUID(),
        role: 'system',
        content: (config.systemPrompt || DEFAULT_SYSTEM_PROMPT) +
            `\n\nYou have access to a local DuckDB database. Always use the 'query_database' tool to answer questions about data.` +
            `\n\nIf the user asks for a chart or visualization, use the 'render_chart' tool. You must query the data first to get the numbers, then formulate the ECharts option.` +
            schemaInfo,
        timestamp: Date.now()
    };

    console.log("[Agent] Final System Prompt:", systemMessage.content);

    // We use a separate array to track the *newly generated* history in this run interaction.
    // The 'messages' prop is the history BEFORE this interaction.
    // We need to notify onUpdate with [...messages, ...newMessages]
    let conversationHistory = [systemMessage, ...messages];
    const newMessages: ChatMessage[] = []; // Track only new messages generated in this session

    const tools = [QUERY_DATABASE_TOOL, RENDER_CHART_TOOL];

    // Max turns to prevent infinite loops
    let turns = 0;
    const MAX_TURNS = 5;

    while (turns < MAX_TURNS) {
        turns++;

        try {
            const stream = await client.chat.completions.create({
                model: config.model,
                messages: conversationHistory as any,
                tools: tools as any,
                tool_choice: 'auto',
                stream: true,
            });

            let accumulatedContent = "";
            let currentToolCalls: { [index: number]: any } = {};

            // Let's create a placeholder assistant message
            let partialAssistantMsg: ChatMessage = { id: randomUUID(), role: 'assistant', content: '', timestamp: Date.now() };

            for await (const chunk of stream) {
                const delta = chunk.choices[0]?.delta;

                if (delta?.content) {
                    accumulatedContent += delta.content;
                    partialAssistantMsg.content = accumulatedContent;
                    // Notify UI with history + current new messages + streaming partial
                    onUpdate([...messages, ...newMessages, partialAssistantMsg]);
                }

                if (delta?.tool_calls) {
                    for (const tc of delta.tool_calls) {
                        if (!currentToolCalls[tc.index]) {
                            currentToolCalls[tc.index] = { id: tc.id, function: { name: "", arguments: "" }, type: 'function' };
                        }
                        if (tc.id) currentToolCalls[tc.index].id = tc.id;
                        if (tc.function?.name) currentToolCalls[tc.index].function.name += tc.function.name;
                        if (tc.function?.arguments) currentToolCalls[tc.index].function.arguments += tc.function.arguments;
                    }
                }
            }

            // Turn finished
            const toolCalls = Object.values(currentToolCalls);

            // Push the completed assistant message to history
            const finalAssistantMsg: ChatMessage = {
                id: partialAssistantMsg.id,
                role: 'assistant',
                content: accumulatedContent,
                tool_calls: toolCalls.length > 0 ? toolCalls : undefined,
                timestamp: Date.now()
            };

            conversationHistory.push(finalAssistantMsg);

            // If no tool calls, we are done
            // Handle Assistant Message
            newMessages.push(finalAssistantMsg);

            // If no tool calls, we are done
            if (toolCalls.length === 0) {
                onUpdate([...messages, ...newMessages]);
                return;
            }

            // Notify state before tools execution
            onUpdate([...messages, ...newMessages]);

            for (const tc of toolCalls) {
                try {
                    const args = JSON.parse(tc.function.arguments);
                    const result = await executeToolCall(tc.function.name, args);

                    // Truncate large results to prevent context window overflow
                    const MAX_RESULT_LENGTH = 2000;
                    const truncatedResult = result.length > MAX_RESULT_LENGTH
                        ? result.slice(0, MAX_RESULT_LENGTH) + `\n...[Truncated. Total length: ${result.length}]`
                        : result;

                    const toolMsg: ChatMessage = {
                        id: randomUUID(),
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: tc.function.name,
                        content: truncatedResult,
                        timestamp: Date.now()
                    };
                    conversationHistory.push(toolMsg);
                    newMessages.push(toolMsg);
                } catch (e: any) {
                    const errorMsg: ChatMessage = {
                        id: randomUUID(),
                        role: 'tool',
                        tool_call_id: tc.id,
                        name: tc.function.name,
                        content: `Error parsing arguments: ${e.message}`,
                        timestamp: Date.now()
                    };
                    conversationHistory.push(errorMsg);
                    newMessages.push(errorMsg);
                }
            }

            // Notify state after tools execution
            onUpdate([...messages, ...newMessages]);

            // Loop continues to next LLM call with tool outputs

        } catch (error) {
            console.error("Agent Error:", error);
            onUpdate([...messages, ...newMessages, { id: randomUUID(), role: 'assistant', content: `Sorry, I encountered an error: ${error}`, timestamp: Date.now() }]);
            return;
        }
    }
}

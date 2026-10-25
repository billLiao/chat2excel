/**
 * Persistence slimming for chat sessions.
 *
 * Chart rows and compiled ECharts options dominate session size but can always
 * be recomputed from the saved definition or the SQL metadata, so they are
 * dropped when a message is written to disk. The live run keeps full messages;
 * only the persisted copies are slimmed, and the renderer rehydrates charts on
 * demand (see LazyChart).
 */

import type { ChatMessage } from '../../src/lib/agent/message';

export function slimMessageForPersist(message: ChatMessage): ChatMessage {
    if (!message.chart && !message.query) return message;
    const slim: ChatMessage = { ...message };
    if (slim.chart) {
        slim.chart = { ...slim.chart, rows: [], option: {} };
    }
    if (slim.query) {
        slim.query = { ...slim.query, rows: slim.query.rows.slice(0, 12) };
    }
    return slim;
}

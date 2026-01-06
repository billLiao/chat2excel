import Store from 'electron-store';
import { randomUUID } from 'node:crypto';

export interface Message {
    role: 'user' | 'assistant';
    content: string;
    thinking?: string;
    timestamp: number;
}

export interface ChatSession {
    id: string;
    title: string;
    messages: Message[];
    createdAt: number;
    updatedAt: number;
}

interface SessionStoreSchema {
    sessions: ChatSession[];
    lastSessionId?: string;
}

const store = new Store<SessionStoreSchema>({
    name: 'sessions', // Separate file: sessions.json
    defaults: {
        sessions: []
    }
});

export const sessionManager = {
    getSessions(): ChatSession[] {
        return store.get('sessions') || [];
    },

    createSession(title: string = 'New Chat'): ChatSession {
        const sessions = this.getSessions();
        const newSession: ChatSession = {
            id: randomUUID(),
            title,
            messages: [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        store.set('sessions', [newSession, ...sessions]);
        store.set('lastSessionId', newSession.id);
        return newSession;
    },

    updateSessionMessages(sessionId: string, messages: Message[]): boolean {
        const sessions = this.getSessions();
        const index = sessions.findIndex(s => s.id === sessionId);
        if (index === -1) return false;

        sessions[index].messages = messages;
        sessions[index].updatedAt = Date.now();
        store.set('sessions', sessions);
        return true;
    },

    renameSession(sessionId: string, title: string): boolean {
        const sessions = this.getSessions();
        const index = sessions.findIndex(s => s.id === sessionId);
        if (index === -1) return false;

        sessions[index].title = title;
        sessions[index].updatedAt = Date.now();
        store.set('sessions', sessions);
        return true;
    },

    deleteSession(sessionId: string): boolean {
        const sessions = this.getSessions();
        const filtered = sessions.filter(s => s.id !== sessionId);
        store.set('sessions', filtered);
        if (store.get('lastSessionId') === sessionId) {
            store.delete('lastSessionId');
        }
        return true;
    }
};

import { useState } from 'react'
import { DataSidebar } from '@/components/data/data-sidebar'
import { FileImportModal } from '@/components/data/file-import-modal'
import { TableView } from '@/components/data/table-view'
import { ChatLayout } from '@/components/chat/chat-layout'
import { SettingsPage } from '@/components/settings/settings-page'
import { MessageSquare, Settings as SettingsIcon, Database, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import '@/lib/i18n' // Ensure initialized

import { ThemeProvider } from '@/components/theme-provider'

function App() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'data' | 'chat' | 'settings'>('data')
    const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

    // Data Tab State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<string>("");
    const [sidebarKey, setSidebarKey] = useState(0);

    const handleImportSuccess = () => {
        setSidebarKey(prev => prev + 1);
    };

    const NavButton = ({ id, label, icon: Icon }: { id: typeof activeTab, label: string, icon: any }) => (
        <button
            onClick={() => setActiveTab(id)}
            title={isSidebarCollapsed ? label : undefined}
            className={cn(
                "w-full px-3 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                isSidebarCollapsed ? "justify-center" : "text-left",
                activeTab === id ? 'bg-accent text-accent-foreground' : 'hover:bg-accent/50 text-muted-foreground'
            )}
        >
            <Icon className="w-4 h-4 shrink-0" />
            {!isSidebarCollapsed && <span className="truncate">{label}</span>}
        </button>
    );

    return (
        <ThemeProvider defaultTheme="system">
            <div className="flex h-screen w-full bg-background text-foreground overflow-hidden">
                {/* Sidebar */}
                <aside className={cn(
                    "border-r bg-muted/40 flex flex-col shrink-0 transition-all duration-300 ease-in-out",
                    isSidebarCollapsed ? "w-16" : "w-64"
                )}>
                    <div className={cn("p-4 border-b flex items-center shrink-0", isSidebarCollapsed ? "justify-center" : "justify-between")}>
                        {!isSidebarCollapsed && (
                            <h1 className="text-xl font-bold bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent truncate">
                                {t('app.title')}
                            </h1>
                        )}
                        {isSidebarCollapsed && <Database className="w-6 h-6 text-primary" />}
                    </div>
                    <nav className="flex-1 p-2 space-y-1 overflow-x-hidden">
                        <NavButton id="data" label={t('nav.data')} icon={Database} />
                        <NavButton id="chat" label={t('nav.chat')} icon={MessageSquare} />
                        <NavButton id="settings" label={t('nav.settings')} icon={SettingsIcon} />
                    </nav>

                    <div className="p-2 border-t shrink-0">
                        <button
                            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
                            className="w-full h-9 flex items-center justify-center rounded-md hover:bg-accent/50 text-muted-foreground transition-colors"
                        >
                            {isSidebarCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
                        </button>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="flex-1 flex flex-col overflow-hidden bg-background relative">
                    {activeTab === 'data' && (
                        <div className="h-full flex overflow-hidden animate-in fade-in duration-300">
                            <DataSidebar
                                key={sidebarKey}
                                onSelectTable={setSelectedTable}
                                onImport={() => setIsImportModalOpen(true)}
                            />
                            <div className="flex-1 overflow-hidden relative">
                                <TableView tableName={selectedTable} />
                            </div>

                            <FileImportModal
                                isOpen={isImportModalOpen}
                                onClose={() => setIsImportModalOpen(false)}
                                onImportSuccess={handleImportSuccess}
                            />
                        </div>
                    )}
                    {activeTab === 'chat' && (
                        <div className="h-full flex flex-col animate-in fade-in duration-300 slide-in-from-bottom-2">
                            <ChatLayout />
                        </div>
                    )}
                    {activeTab === 'settings' && (
                        <div className="h-full overflow-hidden animate-in fade-in duration-300">
                            <SettingsPage />
                        </div>
                    )}
                </main>
            </div>
        </ThemeProvider>
    )
}


export default App

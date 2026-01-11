import { useState } from 'react'
import { DataSidebar } from '@/components/data/data-sidebar'
import { FileImportModal } from '@/components/data/file-import-modal'
import { TableView } from '@/components/data/table-view'
import { ChatLayout } from '@/components/chat/chat-layout'
import { SettingsPage } from '@/components/settings/settings-page'
import { MessageSquare, Settings as SettingsIcon, Database, Minus, Square, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTranslation } from 'react-i18next'
import '@/lib/i18n' // Ensure initialized

import { ThemeProvider } from '@/components/theme-provider'

function App() {
    const { t } = useTranslation();
    const [activeTab, setActiveTab] = useState<'data' | 'chat' | 'settings'>('data')
    // Data Tab State
    const [isImportModalOpen, setIsImportModalOpen] = useState(false);
    const [selectedTable, setSelectedTable] = useState<string>("");
    const [sidebarKey, setSidebarKey] = useState(0);

    console.log('App render, selectedTable:', selectedTable);

    const handleImportSuccess = () => {
        setSidebarKey(prev => prev + 1);
    };

    const NavButton = ({ id, label, icon: Icon, showLabel = true }: { id: typeof activeTab, label: string, icon: any, showLabel?: boolean }) => (
        <button
            onClick={() => setActiveTab(id)}
            title={label}
            className={cn(
                "px-3 py-1.5 rounded-md text-sm font-medium transition-colors flex items-center gap-2",
                activeTab === id
                    ? 'bg-background text-primary shadow-sm'
                    : 'hover:bg-background/50 text-muted-foreground hover:text-foreground'
            )}
        >
            <Icon className="w-4 h-4" />
            {showLabel && <span>{label}</span>}
        </button>
    );

    return (
        <ThemeProvider defaultTheme="system">
            <div className="flex flex-col h-screen w-full bg-background text-foreground overflow-hidden">
                {/* Header Navigation */}
                <header className="border-b bg-muted/40 shrink-0 flex items-center justify-between h-11 select-none" style={{ WebkitAppRegion: 'drag' } as any}>
                    <div className="flex items-center gap-4 px-4 h-full">
                        <div className="flex items-center gap-2 font-bold text-lg">
                            <img src="./icon.png" alt="Logo" className="w-5 h-5" />
                            <span className="bg-gradient-to-r from-primary to-blue-600 bg-clip-text text-transparent">
                                {t('app.title')}
                            </span>
                        </div>

                        {/* Main Tabs - Left Aligned */}
                        <nav className="flex items-center gap-1" style={{ WebkitAppRegion: 'no-drag' } as any}>
                            <NavButton id="data" label={t('nav.data')} icon={Database} />
                            <NavButton id="chat" label={t('nav.chat')} icon={MessageSquare} />
                        </nav>
                    </div>

                    <div className="flex items-center gap-1 pr-2 h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
                        {/* Settings - Icon Only */}
                        <NavButton id="settings" label={t('nav.settings')} icon={SettingsIcon} showLabel={false} />

                        {/* Window Controls - No Divider */}
                        <div className="flex items-center gap-1 ml-1">
                            <button onClick={() => window.api.window.minimize()} className="p-1.5 hover:bg-muted-foreground/10 rounded-md transition-colors">
                                <Minus className="w-4 h-4 text-muted-foreground" />
                            </button>
                            <button onClick={() => window.api.window.maximize()} className="p-1.5 hover:bg-muted-foreground/10 rounded-md transition-colors">
                                <Square className="w-3.5 h-3.5 text-muted-foreground" />
                            </button>
                            <button onClick={() => window.api.window.close()} className="p-1.5 hover:bg-red-500 hover:text-white rounded-md transition-colors">
                                <X className="w-4 h-4 text-muted-foreground hover:text-white" />
                            </button>
                        </div>
                    </div>
                </header>

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

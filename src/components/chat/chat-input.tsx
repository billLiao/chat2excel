import { useState, useEffect, type KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { SendHorizontal, Loader2, Database, Brain, Settings } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface ChatInputProps {
    onSend: (message: string, contextTables: string[], modelConfig: any) => void;
    disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: ChatInputProps) {
    const { t } = useTranslation();
    const [input, setInput] = useState('');
    const [tables, setTables] = useState<{ name: string, displayName: string }[]>([]);
    const [selectedTables, setSelectedTables] = useState<string[]>([]);

    // Model Selection
    const [models, setModels] = useState<any[]>([]);
    const [selectedModelName, setSelectedModelName] = useState("");

    useEffect(() => {
        const fetchData = async () => {
            // Load Tables
            const tableRes = await window.api.db.getTables();
            if (tableRes.success && tableRes.data) {
                setTables(tableRes.data);
                // Initially select all tables if no selection exists
                if (selectedTables.length === 0) {
                    setSelectedTables(tableRes.data.map((t: any) => t.name));
                }
            }

            // Load Models from settings
            const storedModels = await window.api.settings.get('models') || [];
            const activeModelId = await window.api.settings.get('activeModelId');

            setModels(storedModels);
            if (activeModelId && storedModels.some((m: any) => m.name === activeModelId)) {
                setSelectedModelName(activeModelId);
            } else if (storedModels.length > 0) {
                setSelectedModelName(storedModels[0].name);
            }
        };

        fetchData();
    }, []);

    const handleSend = () => {
        if (input.trim() && !disabled) {
            const currentModel = models.find(m => m.name === selectedModelName) || models[0];
            onSend(input, selectedTables, currentModel);
            setInput('');
        }
    };

    const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    const toggleTable = (name: string) => {
        setSelectedTables(prev =>
            prev.includes(name)
                ? prev.filter(n => n !== name)
                : [...prev, name]
        );
    };

    const selectAllTables = (e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedTables(tables.map(t => t.name));
    };

    return (
        <div className="flex flex-col gap-2 max-w-4xl mx-auto w-full group">
            <div className="relative flex flex-col bg-card border rounded-2xl shadow-sm focus-within:ring-2 focus-within:ring-primary/20 transition-all overflow-hidden">
                <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder={t('chat.placeholder')}
                    disabled={disabled}
                    className="w-full min-h-[100px] max-h-[300px] resize-none bg-transparent px-4 py-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
                    rows={1}
                />

                <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-t mt-auto">
                    <div className="flex items-center gap-2 overflow-hidden">
                        {/* Table Selector */}
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className={cn(
                                        "h-7 gap-1.5 px-2.5 text-xs font-semibold rounded-lg transition-colors border border-transparent",
                                        selectedTables.length > 0
                                            ? "bg-primary/10 text-primary border-primary/20 hover:bg-primary/20"
                                            : "bg-muted text-muted-foreground hover:bg-muted/80"
                                    )}
                                >
                                    <Database className="w-3.5 h-3.5" />
                                    <span className="max-w-[120px] truncate">
                                        {selectedTables.length === 0
                                            ? t('chat.no_context')
                                            : t('chat.tables_count', { count: selectedTables.length })}
                                    </span>
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start" className="w-56">
                                <DropdownMenuLabel className="flex items-center justify-between text-xs">
                                    {t('chat.data_context')}
                                    <span
                                        onClick={selectAllTables}
                                        className="text-[10px] font-normal text-primary cursor-pointer hover:underline"
                                    >
                                        {t('chat.select_all')}
                                    </span>
                                </DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <div className="max-h-60 overflow-y-auto">
                                    {tables.length === 0 && (
                                        <div className="p-2 text-xs text-muted-foreground text-center">{t('chat.no_data_imported')}</div>
                                    )}
                                    {tables.map(table => (
                                        <DropdownMenuCheckboxItem
                                            key={table.name}
                                            checked={selectedTables.includes(table.name)}
                                            onCheckedChange={() => toggleTable(table.name)}
                                            className="text-xs"
                                        >
                                            <span className="truncate">{table.displayName}</span>
                                        </DropdownMenuCheckboxItem>
                                    ))}
                                </div>
                            </DropdownMenuContent>
                        </DropdownMenu>

                        {/* Model Selector */}
                        <Select value={selectedModelName} onValueChange={setSelectedModelName}>
                            <SelectTrigger className="h-7 w-[160px] text-xs border-none bg-transparent hover:bg-muted shadow-none focus:ring-0 px-2 gap-1.5 font-semibold text-muted-foreground">
                                <Brain className="w-3.5 h-3.5 shrink-0" />
                                <SelectValue placeholder={t('chat.no_model')} />
                            </SelectTrigger>
                            <SelectContent>
                                {models.length === 0 ? (
                                    <div className="p-2 flex flex-col gap-2">
                                        <div className="text-xs text-muted-foreground px-2 text-center">{t('chat.no_models_configured')}</div>
                                        <Button variant="outline" size="sm" className="h-7 text-xs w-full" onClick={() => window.location.hash = '#/settings'}>
                                            <Settings className="w-3 h-3 mr-1" /> {t('settings.title')}
                                        </Button>
                                    </div>
                                ) : (
                                    models.map(m => (
                                        <SelectItem key={m.name} value={m.name} className="text-xs">
                                            {m.name}
                                        </SelectItem>
                                    ))
                                )}
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        size="sm"
                        onClick={handleSend}
                        disabled={!input.trim() || disabled}
                        className={cn(
                            "rounded-lg gap-2 h-8 px-4 font-semibold shadow-sm transition-all",
                            input.trim() ? "bg-primary hover:scale-[1.02] active:scale-[0.98]" : "bg-muted-foreground/30 text-muted-foreground"
                        )}
                    >
                        {disabled ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="h-3.5 w-3.5" />}
                        {t('chat.send')}
                    </Button>
                </div>
            </div>

            <div className="flex justify-between items-center px-1">
                <span className="text-[10px] text-muted-foreground opacity-50 font-medium">{t('chat.footer_note')}</span>
                <span className="text-[10px] text-muted-foreground opacity-50 font-bold uppercase tracking-tight">{t('chat.press_enter')}</span>
            </div>
        </div>
    );
}

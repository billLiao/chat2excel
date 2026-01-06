import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Database, FolderOpen, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface DataSidebarProps {
    onSelectTable: (tableName: string) => void;
    onImport: () => void;
}

interface TableInfo {
    name: string;
    displayName: string;
}

export function DataSidebar({ onSelectTable, onImport }: DataSidebarProps) {
    const { t } = useTranslation();
    const [tables, setTables] = useState<TableInfo[]>([]);
    const [selectedTable, setSelectedTable] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const fetchTables = async () => {
        setLoading(true);
        try {
            const result = await window.api.db.getTables();
            if (result.success && result.data) {
                setTables(result.data);
            } else {
                console.error('Failed to fetch tables:', result.error);
            }
        } catch (error) {
            console.error('Error fetching tables:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTables();
    }, []);

    const handleSelect = (tableName: string) => {
        setSelectedTable(tableName);
        onSelectTable(tableName);
    };

    return (
        <div className="flex flex-col h-full bg-muted/20 border-r w-64">
            <div className="p-4 border-b flex items-center justify-between">
                <h2 className="font-semibold text-sm flex items-center gap-2">
                    <Database className="w-4 h-4" />
                    {t('data.assets')}
                </h2>
                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={fetchTables} disabled={loading}>
                    <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
                </Button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {tables.length === 0 && !loading && (
                    <div className="text-xs text-muted-foreground text-center py-8">
                        {t('data.no_tables')}
                    </div>
                )}

                {tables.map((table) => (
                    <button
                        key={table.name}
                        onClick={() => handleSelect(table.name)}
                        className={cn(
                            "w-full text-left px-3 py-2 rounded-md text-sm transition-colors flex items-center gap-2",
                            selectedTable === table.name
                                ? "bg-primary text-primary-foreground"
                                : "hover:bg-accent hover:text-accent-foreground text-muted-foreground"
                        )}
                    >
                        <span className="truncate">{table.displayName}</span>
                    </button>
                ))}
            </div>

            <div className="p-4 border-t">
                <Button className="w-full gap-2" variant="outline" onClick={onImport}>
                    <FolderOpen className="w-4 h-4" />
                    {t('data.import')}
                </Button>
            </div>
        </div>
    );
}

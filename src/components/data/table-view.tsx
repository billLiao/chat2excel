import { useEffect, useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Loader2, AlertCircle, Info, Database, Edit2, Check, X, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useTranslation } from 'react-i18next';

interface TableViewProps {
    tableName: string;
}

interface ColumnInfo {
    name: string;
    type: string;
    description: string;
}

export function TableView({ tableName }: TableViewProps) {
    const { t } = useTranslation();
    const [data, setData] = useState<any[]>([]);
    const [columns, setColumns] = useState<ColumnInfo[]>([]);
    const [displayName, setDisplayName] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [editingCol, setEditingCol] = useState<string | null>(null);
    const [editValue, setEditValue] = useState("");
    const [tableDesc, setTableDesc] = useState("");
    const [isEditingTableDesc, setIsEditingTableDesc] = useState(false);
    const [isDeleting, setIsDeleting] = useState(false);

    const fetchData = async () => {
        if (!tableName) return;
        setLoading(true);
        setError(null);

        try {
            // 1. Get sample data
            const sql = `SELECT * FROM ${tableName} LIMIT 100`;
            const result = await window.api.db.executeSQL(sql);

            // 2. Get detailed column info
            const colResult = await window.api.db.getColumns(tableName);

            // 3. Get table list to find current table metadata
            const tablesRes = await window.api.db.getTables();

            if (result.success && colResult.success && tablesRes.success) {
                setData(result.data || []);
                setColumns(colResult.data || []);
                const currentTable = tablesRes.data?.find(t => t.name === tableName);
                setTableDesc(currentTable?.description || "");
                setDisplayName(currentTable?.displayName || tableName);
            } else {
                setError(result.error || colResult.error || t('data.fetch_failed'));
            }
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
    }, [tableName]);

    const handleUpdateColumnDesc = async (columnName: string) => {
        try {
            const res = await window.api.db.updateColumnDesc(tableName, columnName, editValue);
            if (res.success) {
                setEditingCol(null);
                fetchData();
            }
        } catch (err) {
            console.error("Failed to update description", err);
        }
    };

    const handleUpdateTableDesc = async () => {
        try {
            const res = await window.api.db.updateTableDesc(tableName, tableDesc);
            if (res.success) {
                setIsEditingTableDesc(false);
            }
        } catch (err) {
            console.error("Failed to update table description", err);
        }
    };

    const handleDeleteTable = async () => {
        if (!window.confirm(t('data.delete_confirm', { name: displayName || tableName }))) return;

        setIsDeleting(true);
        try {
            const res = await window.api.db.dropTable(tableName);
            if (res.success) {
                // Refresh the whole app or redirect
                window.location.reload();
            }
        } catch (err) {
            console.error("Failed to delete table", err);
        } finally {
            setIsDeleting(false);
        }
    };

    if (loading) {
        return (
            <div className="flex h-full items-center justify-center text-muted-foreground gap-2">
                <Loader2 className="w-5 h-5 animate-spin" />
                {t('common.loading')}
            </div>
        );
    }

    if (error) {
        return (
            <div className="p-6 text-destructive flex items-center gap-2 text-sm italic">
                <AlertCircle className="w-4 h-4" />
                {t('data.error')}: {error}
            </div>
        );
    }

    if (!tableName) {
        return (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground gap-4">
                <div className="p-4 rounded-full bg-muted/50">
                    <Database className="w-12 h-12 opacity-20" />
                </div>
                <p className="text-sm">{t('data.select_table')}</p>
            </div>
        );
    }

    const colNames = columns.map(c => c.name);

    return (
        <div className="flex flex-col h-full overflow-hidden">
            <header className="px-6 py-4 border-b bg-background/50 backdrop-blur-md sticky top-0 z-20">
                <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0 pr-4">
                        <div className="flex items-center gap-2">
                            <h2 className="text-xl font-bold tracking-tight truncate">{displayName || tableName}</h2>
                            <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                                onClick={handleDeleteTable}
                                disabled={isDeleting}
                            >
                                <Trash2 className="w-4 h-4" />
                            </Button>
                        </div>

                        <div className="mt-1 flex items-center gap-2 group">
                            {isEditingTableDesc ? (
                                <div className="flex items-center gap-1 w-full max-w-xl">
                                    <Input
                                        autoFocus
                                        value={tableDesc}
                                        onChange={(e) => setTableDesc(e.target.value)}
                                        className="h-7 text-xs flex-1"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleUpdateTableDesc();
                                            if (e.key === 'Escape') setIsEditingTableDesc(false);
                                        }}
                                    />
                                    <Button size="icon" variant="ghost" className="h-7 w-7 text-primary" onClick={handleUpdateTableDesc}>
                                        <Check className="w-3.5 h-3.5" />
                                    </Button>
                                </div>
                            ) : (
                                <p
                                    className="text-sm text-muted-foreground truncate cursor-pointer hover:text-foreground transition-colors flex items-center gap-1.5"
                                    onClick={() => setIsEditingTableDesc(true)}
                                >
                                    <Info className="w-3.5 h-3.5 shrink-0" />
                                    {tableDesc || t('data.add_desc')}
                                    <Edit2 className="w-3 h-3 opacity-0 group-hover:opacity-100" />
                                </p>
                            )}
                        </div>
                    </div>
                </div>
            </header>

            <Tabs defaultValue="preview" className="flex-1 flex flex-col overflow-hidden">
                <div className="px-6 border-b bg-muted/30">
                    <TabsList className="h-10 bg-transparent p-0 gap-6">
                        <TabsTrigger
                            value="preview"
                            className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1"
                        >
                            {t('data.preview')}
                        </TabsTrigger>
                        <TabsTrigger
                            value="schema"
                            className="h-10 rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-1"
                        >
                            {t('data.schema')}
                        </TabsTrigger>
                    </TabsList>
                </div>

                <TabsContent value="preview" className="flex-1 overflow-auto m-0 p-0 border-none outline-none">
                    <Table>
                        <TableHeader className="sticky top-0 bg-background/80 backdrop-blur-sm shadow-sm z-10">
                            <TableRow>
                                {colNames.map((col) => (
                                    <TableHead key={col} className="min-w-[150px] font-bold text-foreground py-3">
                                        {col}
                                    </TableHead>
                                ))}
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {data.map((row, idx) => (
                                <TableRow key={idx} className="hover:bg-muted/30 transition-colors">
                                    {colNames.map((col) => (
                                        <TableCell key={`${idx}-${col}`} className="font-mono text-[11px] py-2">
                                            {row[col]?.toString() ?? <span className="text-muted-foreground/50 italic font-sans text-[10px]">null</span>}
                                        </TableCell>
                                    ))}
                                </TableRow>
                            ))}
                            {data.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={colNames.length || 1} className="h-64 text-center text-muted-foreground">
                                        {t('data.empty')}
                                    </TableCell>
                                </TableRow>
                            )}
                        </TableBody>
                    </Table>
                </TabsContent>

                <TabsContent value="schema" className="flex-1 overflow-auto m-0 p-6 border-none outline-none bg-muted/10">
                    <div className="max-w-4xl mx-auto space-y-6">
                        <Card className="border shadow-sm">
                            <CardHeader className="bg-muted/10">
                                <CardTitle className="text-lg">{t('data.table_structure')}</CardTitle>
                                <CardDescription>{t('data.define_logic')}</CardDescription>
                            </CardHeader>
                            <CardContent className="p-0">
                                <Table>
                                    <TableHeader>
                                        <TableRow>
                                            <TableHead className="w-[180px]">{t('data.col_name')}</TableHead>
                                            <TableHead className="w-[120px]">{t('data.col_type')}</TableHead>
                                            <TableHead>{t('data.col_desc')}</TableHead>
                                            <TableHead className="w-[80px] text-right">{t('data.action')}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {columns.map((col) => (
                                            <TableRow key={col.name} className="group">
                                                <TableCell className="font-medium">{col.name}</TableCell>
                                                <TableCell className="text-xs text-muted-foreground uppercase">{col.type}</TableCell>
                                                <TableCell>
                                                    {editingCol === col.name ? (
                                                        <Input
                                                            autoFocus
                                                            value={editValue}
                                                            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setEditValue(e.target.value)}
                                                            className="h-8 text-sm"
                                                            placeholder={t('data.no_desc')}
                                                            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                                                                if (e.key === 'Enter') handleUpdateColumnDesc(col.name);
                                                                if (e.key === 'Escape') setEditingCol(null);
                                                            }}
                                                        />
                                                    ) : (
                                                        <span className={col.description ? "text-sm" : "text-sm text-muted-foreground italic"}>
                                                            {col.description || t('data.no_desc')}
                                                        </span>
                                                    )}
                                                </TableCell>
                                                <TableCell className="text-right">
                                                    {editingCol === col.name ? (
                                                        <div className="flex justify-end gap-1">
                                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => handleUpdateColumnDesc(col.name)}>
                                                                <Check className="w-4 h-4" />
                                                            </Button>
                                                            <Button size="icon" variant="ghost" className="h-7 w-7 text-muted-foreground" onClick={() => setEditingCol(null)}>
                                                                <X className="w-4 h-4" />
                                                            </Button>
                                                        </div>
                                                    ) : (
                                                        <Button
                                                            size="icon"
                                                            variant="ghost"
                                                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            onClick={() => {
                                                                setEditingCol(col.name);
                                                                setEditValue(col.description);
                                                            }}
                                                        >
                                                            <Edit2 className="w-3.5 h-3.5" />
                                                        </Button>
                                                    )}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </div>
                </TabsContent>
            </Tabs>
        </div>
    );
}

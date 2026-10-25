import { useState } from 'react';
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Download, Loader2 } from 'lucide-react';
import { exportToExcel } from '@/lib/export';
import { useTranslation } from 'react-i18next';

interface TablePreviewModalProps {
    open: boolean;
    onClose: () => void;
    data: unknown[];
    columns?: string[];
    /** When present, export goes through the main-process artifact store. */
    queryId?: string;
    title: string;
}

export function TablePreviewModal({
    open,
    onClose,
    data,
    columns: columnProp,
    queryId,
    title,
}: TablePreviewModalProps) {
    const { t } = useTranslation();
    const [exporting, setExporting] = useState(false);
    const [error, setError] = useState<string | null>(null);

    if (!data || data.length === 0) {
        return null;
    }

    const columns = columnProp?.length
        ? columnProp
        : Object.keys(data[0] as Record<string, unknown>);

    const handleDownload = async () => {
        setError(null);
        setExporting(true);
        try {
            if (queryId) {
                const result = await window.api.export.query(queryId, title || 'export');
                if (!result.success && !result.canceled) {
                    setError(result.error || t('chat.export_failed'));
                }
            } else {
                exportToExcel(data as any[], `${title || 'export'}.xlsx`);
            }
        } catch (err: any) {
            setError(err?.message || t('chat.export_failed'));
        } finally {
            setExporting(false);
        }
    };

    return (
        <Dialog open={open} onOpenChange={(isOpen: boolean) => !isOpen && onClose()}>
            <DialogContent className="max-w-4xl max-h-[80vh] flex flex-col">
                <DialogHeader className="flex flex-row items-center justify-between pr-8">
                    <DialogTitle>{title || t('chat.table_preview')}</DialogTitle>
                    <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={handleDownload}
                        disabled={exporting}
                    >
                        {exporting ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Download className="w-4 h-4" />
                        )}
                        {t('chat.export_excel')}
                    </Button>
                </DialogHeader>
                {error && (
                    <div className="text-xs text-destructive bg-destructive/10 border border-destructive/20 rounded p-2">
                        {error}
                    </div>
                )}
                <div className="flex-1 overflow-auto border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 sticky top-0">
                            <tr>
                                {columns.map((col) => (
                                    <th
                                        key={col}
                                        className="px-4 py-2 text-left font-medium border-b whitespace-nowrap"
                                    >
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {data.map((row, rowIndex) => (
                                <tr
                                    key={rowIndex}
                                    className="hover:bg-muted/30 transition-colors"
                                >
                                    {columns.map((col) => (
                                        <td
                                            key={col}
                                            className="px-4 py-2 border-b whitespace-nowrap"
                                        >
                                            {String(
                                                (row as Record<string, unknown>)[col] ?? '-'
                                            )}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </DialogContent>
        </Dialog>
    );
}

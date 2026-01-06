import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Download } from 'lucide-react';
import { exportToExcel } from '@/lib/export';
import { useTranslation } from 'react-i18next';

interface TablePreviewModalProps {
    open: boolean;
    onClose: () => void;
    data: any[];
    title: string;
}

export function TablePreviewModal({ open, onClose, data, title }: TablePreviewModalProps) {
    const { t } = useTranslation();

    if (!data || data.length === 0) {
        return null;
    }

    const columns = Object.keys(data[0]);

    const handleDownload = () => {
        exportToExcel(data, `${title || 'export'}.xlsx`);
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
                    >
                        <Download className="w-4 h-4" />
                        {t('chat.export_excel')}
                    </Button>
                </DialogHeader>
                <div className="flex-1 overflow-auto border rounded-lg">
                    <table className="w-full text-sm">
                        <thead className="bg-muted/50 sticky top-0">
                            <tr>
                                {columns.map((col) => (
                                    <th
                                        key={col}
                                        className="px-4 py-2 text-left font-medium border-b"
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
                                            className="px-4 py-2 border-b"
                                        >
                                            {row[col] ?? '-'}
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

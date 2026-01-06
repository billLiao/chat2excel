import { useState, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Upload, X, AlertCircle, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface FileImportModalProps {
    isOpen: boolean;
    onClose: () => void;
    onImportSuccess: () => void;
}

export function FileImportModal({ isOpen, onClose, onImportSuccess }: FileImportModalProps) {
    const { t } = useTranslation();
    const [isDragging, setIsDragging] = useState(false);
    const [importing, setImporting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    if (!isOpen) return null;

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = () => {
        setIsDragging(false);
    };

    const processFile = async (file: File) => {
        // Basic validation
        const validExtensions = ['.csv', '.xlsx', '.xls'];
        const isCsvOrExcel = validExtensions.some(ext => file.name.toLowerCase().endsWith(ext));

        if (!isCsvOrExcel) {
            setError(t('data.invalid_file'));
            return;
        }

        setImporting(true);
        setError(null);

        try {
            // Use Electron's webUtils via our API bridge to get the absolute path
            const filePath = window.api.utils.getPathForFile(file);

            if (!filePath) {
                throw new Error(t('data.path_error'));
            }

            const result = await window.api.db.importFile(filePath);

            if (result.success) {
                onImportSuccess();
                onClose();
            } else {
                setError(result.error || t('data.import_failed'));
            }
        } catch (err: any) {
            setError(err.message || t('data.import_failed'));
        } finally {
            setImporting(false);
        }
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files[0]);
        }
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
            <div className="w-full max-w-md border bg-card p-6 shadow-lg sm:rounded-lg">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-semibold">{t('data.import_title')}</h3>
                    <Button variant="ghost" size="icon" onClick={onClose} disabled={importing}>
                        <X className="w-4 h-4" />
                    </Button>
                </div>

                <div
                    className={cn(
                        "border-2 border-dashed rounded-lg p-10 flex flex-col items-center justify-center gap-4 transition-colors cursor-pointer bg-muted/10",
                        isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25",
                        importing && "opacity-50 pointer-events-none"
                    )}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept=".csv,.xlsx,.xls"
                        onChange={handleFileSelect}
                    />

                    <div className="p-4 rounded-full bg-primary/10">
                        <Upload className="w-8 h-8 text-primary" />
                    </div>

                    <div className="text-center">
                        <p className="font-medium">{t('data.drag_desc')}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                            {t('data.supported_formats')}
                        </p>
                    </div>
                </div>

                {error && (
                    <div className="mt-4 p-3 text-sm text-destructive bg-destructive/10 rounded-md flex items-center gap-2">
                        <AlertCircle className="w-4 h-4" />
                        {error}
                    </div>
                )}

                {importing && (
                    <div className="mt-4 flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        {t('data.importing')}
                    </div>
                )}

                <div className="mt-6 text-xs text-muted-foreground bg-muted/50 p-3 rounded border">
                    🔒 {t('data.privacy_note')}
                </div>
            </div>
        </div>
    );
}

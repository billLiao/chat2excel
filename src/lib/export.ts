import * as XLSX from 'xlsx';

export const exportToExcel = (data: any[], filename: string = 'export.xlsx') => {
    if (!data || data.length === 0) {
        console.warn("No data to export");
        return;
    }

    const worksheet = XLSX.utils.json_to_sheet(data);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");

    XLSX.writeFile(workbook, filename);
};

import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'path'
import { db } from './db'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// const __filename = fileURLToPath(import.meta.url)
import { store } from './store'
import { sessionManager } from './session'

// Register IPC handlers
ipcMain.handle('settings:get', (_, key) => {
    return store.get(key);
});

ipcMain.handle('settings:set', (_, key, value) => {
    store.set(key, value);
    return true;
});

ipcMain.handle('db:execute-sql', async (_, sql: string) => {
    try {
        console.log('Executing SQL:', sql);
        const result = await db.execute(sql);
        return { success: true, data: result };
    } catch (error: any) {
        console.error('SQL Execution Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:import-file', async (_, filePath: string) => {
    try {
        console.log('Importing file:', filePath);
        const tableName = await db.importFile(filePath);
        return { success: true, tableName };
    } catch (error: any) {
        console.error('File Import Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:get-tables', async () => {
    try {
        const tables = await db.getTables();
        return { success: true, data: tables };
    } catch (error: any) {
        console.error('Get Tables Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:get-columns', async (_, tableName: string) => {
    try {
        const columns = await db.getTableColumns(tableName);
        return { success: true, data: columns };
    } catch (error: any) {
        console.error('Get Columns Error:', error);
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:update-table-desc', async (_, tableName: string, description: string) => {
    try {
        await db.updateTableDescription(tableName, description);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:update-column-desc', async (_, tableName: string, columnName: string, description: string) => {
    try {
        await db.updateColumnDescription(tableName, columnName, description);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

ipcMain.handle('db:drop-table', async (_, tableName: string) => {
    try {
        await db.dropTable(tableName);
        return { success: true };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
});

// --- Session Handlers ---
ipcMain.handle('session:list', () => sessionManager.getSessions());
ipcMain.handle('session:create', (_, title) => sessionManager.createSession(title));
ipcMain.handle('session:update-messages', (_, sessionId, messages) => sessionManager.updateSessionMessages(sessionId, messages));
ipcMain.handle('session:rename', (_, sessionId, title) => sessionManager.renameSession(sessionId, title));
ipcMain.handle('session:delete', (_, sessionId) => sessionManager.deleteSession(sessionId));


process.env.DIST = path.join(__dirname, '../dist')
process.env.VITE_PUBLIC = app.isPackaged ? process.env.DIST : path.join(process.env.DIST, '../public')

let win: BrowserWindow | null

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']

function createWindow() {
    win = new BrowserWindow({
        icon: path.join(process.env.VITE_PUBLIC || '', 'icon.png'),
        frame: false, // Frameless window
        webPreferences: {
            preload: path.join(__dirname, 'preload.mjs'),
            nodeIntegration: true, // Empowering for local tool - as per PRD "DuckDB Node binding"
            contextIsolation: false, // Simplifying for MVP as per PRD architecture simplicity
        },
    })

    // Window controls IPC
    ipcMain.handle('window:minimize', () => win?.minimize());
    ipcMain.handle('window:maximize', () => {
        if (win?.isMaximized()) {
            win.unmaximize();
        } else {
            win?.maximize();
        }
    });
    ipcMain.handle('window:close', () => win?.close());

    // Hide top menu bar
    win.setMenu(null);

    // Test active push message to Renderer-process.
    win.webContents.on('did-finish-load', () => {
        win?.webContents.send('main-process-message', (new Date).toLocaleString())
    })

    // Register shortcut to toggle DevTools
    win.webContents.on('before-input-event', (_, input) => {
        if (input.control && input.key.toLowerCase() === 'i') {
            win?.webContents.toggleDevTools();
        }
    });

    if (VITE_DEV_SERVER_URL) {
        console.log('Loading URL:', VITE_DEV_SERVER_URL);
        const load = () => {
            win?.loadURL(VITE_DEV_SERVER_URL).catch((e) => {
                console.error('Failed to load URL, retrying in 1s:', e.message);
                setTimeout(load, 1000);
            });
        };
        load();
    } else {
        // win.loadFile('dist/index.html')
        win.loadFile(path.join(process.env.DIST || '', 'index.html'))
    }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit()
        win = null
    }
})

app.on('activate', () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
    }
})

app.whenReady().then(async () => {
    try {
        await db.init();
        createWindow();
    } catch (error) {
        console.error('Failed to initialize application:', error);
        app.quit();
    }
})

import { defineConfig } from 'vite'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import path from 'path'
import pkg from './package.json'

const contentSecurityPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "form-action 'none'",
].join('; ')

/**
 * Production-only CSP. The dev server needs inline scripts for React refresh,
 * so the policy is injected into the built HTML instead of source.
 */
function productionCsp() {
    return {
        name: 'chat2excel-production-csp',
        apply: 'build' as const,
        transformIndexHtml(html: string) {
            return html.replace(
                '</title>',
                `</title>\n  <meta http-equiv="Content-Security-Policy" content="${contentSecurityPolicy}" />`
            )
        },
    }
}

export default defineConfig({
    define: {
        __APP_VERSION__: JSON.stringify(pkg.version),
    },
    server: {
        port: 5173,
        strictPort: true,
        host: '127.0.0.1',
    },
    plugins: [
        productionCsp(),
        react(),
        electron({
            main: {
                // Shortcut of `build.lib.entry`.
                entry: 'electron/main.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            external: [
                                'duckdb',
                                'electron-store',
                                'exceljs',
                                'xlsx',
                                /^@earendil-works\//,
                                /^@modelcontextprotocol\//,
                            ],
                        },
                    },
                },
            },
            preload: {
                // Shortcut of `build.rollupOptions.input`.
                // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
                input: 'electron/preload.ts',
                vite: {
                    build: {
                        rollupOptions: {
                            output: {
                                // The package is ESM ("type": "module"), so a `.mjs`
                                // preload would be evaluated as ESM where `require`
                                // is unavailable. Emit CommonJS with a `.cjs`
                                // extension so Electron loads it correctly.
                                format: 'cjs',
                                entryFileNames: '[name].cjs',
                            },
                        },
                    },
                },
            },
            // Ployfill the Electron and Node.js built-in modules for Renderer process.
            // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
            renderer: {},
        }),
    ],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
})

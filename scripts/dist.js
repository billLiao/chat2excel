/**
 * 带版本号输出目录的打包脚本
 * 读取 package.json 版本号，设置输出目录为 release/{version}/
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagePath = path.resolve(__dirname, '../package.json');

const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
const version = pkg.version;

console.log(`正在打包版本 ${version}...`);
console.log(`输出目录: release/${version}/`);

// 使用 electron-builder 的 -c.directories.output 参数覆盖输出目录
try {
    execSync(`electron-builder -c.directories.output=release/${version}`, {
        cwd: path.resolve(__dirname, '..'),
        stdio: 'inherit',
        shell: true
    });
    console.log(`\n✓ 打包完成! 产物位于: release/${version}/`);
} catch (error) {
    process.exit(1);
}

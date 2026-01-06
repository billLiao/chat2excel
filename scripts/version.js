/**
 * 版本号自动更新脚本
 * 用法:
 *   node scripts/version.js patch  - 增加补丁版本 x.x.X+1 (用于 build)
 *   node scripts/version.js minor  - 增加次版本 x.X+1.0 (用于 dist)
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packagePath = path.resolve(__dirname, '../package.json');

function updateVersion(type) {
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    const [major, minor, patch] = pkg.version.split('.').map(Number);

    let newVersion;
    if (type === 'patch') {
        newVersion = `${major}.${minor}.${patch + 1}`;
    } else if (type === 'minor') {
        newVersion = `${major}.${minor + 1}.0`;
    } else if (type === 'major') {
        newVersion = `${major + 1}.0.0`;
    } else {
        console.error('用法: node scripts/version.js [patch|minor|major]');
        process.exit(1);
    }

    pkg.version = newVersion;
    fs.writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');
    console.log(`版本已更新: ${major}.${minor}.${patch} -> ${newVersion}`);

    return newVersion;
}

const type = process.argv[2];
if (type) {
    updateVersion(type);
} else {
    // 如果没有参数，只输出当前版本
    const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
    console.log(pkg.version);
}

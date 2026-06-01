const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

async function convertDir(dir, quality = 92) {
    const absDir = path.resolve(dir);
    const entries = await fs.promises.readdir(absDir);
    const tifFiles = entries.filter(name => name.toLowerCase().endsWith('.tif') || name.toLowerCase().endsWith('.tiff'));

    if (!tifFiles.length) {
        console.log(`No .tif files found in ${absDir}`);
        return;
    }

    for (const file of tifFiles) {
        const src = path.join(absDir, file);
        const dest = src.replace(/\.(tif|tiff)$/i, '.jpg');
        try {
            console.log(`Converting ${file} → ${path.basename(dest)} ...`);
            await sharp(src)
                .jpeg({ quality, chromaSubsampling: '4:4:4' })
                .toFile(dest);
        } catch (err) {
            console.error(`Failed to convert ${file}:`, err.message);
            throw err;
        }
    }

    console.log('Conversion complete.');
}

if (require.main === module) {
    const targetDir = process.argv[2];
    if (!targetDir) {
        console.error('Usage: node scripts/convert_tif_to_jpg.js <directory> [quality]');
        process.exit(1);
    }
    const quality = process.argv[3] ? Number(process.argv[3]) : 92;
    convertDir(targetDir, quality).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = { convertDir };

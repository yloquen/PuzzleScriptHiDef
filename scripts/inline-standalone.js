'use strict';

// Pack standalone.html and its local scripts into src/standalone_inlined.txt.
// Export embeds that file, so it has to contain the current engine.

const fs = require('fs');
const path = require('path');

function inlineStandalone(root) {
    const srcDir = path.join(root, 'src');
    let html = fs.readFileSync(path.join(srcDir, 'standalone.html'), 'utf8');
    html = html.replace(/<script src="([^"]+)"><\/script>/g, function (tag, src) {
        const filePath = src.split('?')[0];
        if (/^(https?:|data:)/i.test(filePath)) {
            return tag;
        }
        let code = fs.readFileSync(path.join(srcDir, filePath), 'utf8');
        code = code.replace(/<\/script/gi, '<\\/script');
        return '<script>\n' + code + '\n</script>';
    });
    fs.writeFileSync(path.join(srcDir, 'standalone_inlined.txt'), html);
}

if (require.main === module) {
    inlineStandalone(path.join(__dirname, '..'));
    console.log('Wrote src/standalone_inlined.txt');
}

module.exports = { inlineStandalone };

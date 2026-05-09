import fs from 'fs';

const content = fs.readFileSync('c:\\Users\\ZBrindz\\Desktop\\Development\\2026\\herd-search\\herd-search\\herd-search-vite\\src\\App.tsx', 'utf8');
let open = 0;
let close = 0;
let inString = false;
let quoteChar = '';
let inComment = false;
let multiLineComment = false;

for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const nextChar = content[i+1];

    if (inComment) {
        if (char === '\n') inComment = false;
        continue;
    }
    if (multiLineComment) {
        if (char === '*' && nextChar === '/') {
            multiLineComment = false;
            i++;
        }
        continue;
    }

    if (inString) {
        if (char === quoteChar && content[i-1] !== '\\') {
            inString = false;
        }
        continue;
    }

    if (char === '/' && nextChar === '/') {
        inComment = true;
        i++;
        continue;
    }
    if (char === '/' && nextChar === '*') {
        multiLineComment = true;
        i++;
        continue;
    }

    if (char === "'" || char === '"' || char === '`') {
        inString = true;
        quoteChar = char;
        continue;
    }

    if (char === '{') open++;
    if (char === '}') close++;
}

console.log(`Open: ${open}, Close: ${close}`);

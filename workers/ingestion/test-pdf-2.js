
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

try {
    const pdf = require('pdf-parse/lib/pdf-parse.js');
    console.log('Direct Lib Type:', typeof pdf);
    console.log('Direct Lib Is Function:', typeof pdf === 'function');
} catch (e) {
    console.error('Failed to require lib:', e.message);
}

try {
    const index = require('pdf-parse/index.js');
     console.log('Index Type:', typeof index);
} catch(e) {
    console.error('Failed to require index:', e.message);
}


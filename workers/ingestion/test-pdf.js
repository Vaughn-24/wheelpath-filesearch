
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

try {
    const pdf = require('pdf-parse');
    console.log('Type:', typeof pdf);
    console.log('Is Array:', Array.isArray(pdf));
    console.log('Keys:', Object.keys(pdf));
    console.log('Default:', pdf.default);
    if (pdf.default) console.log('Default Type:', typeof pdf.default);
} catch (e) {
    console.error(e);
}


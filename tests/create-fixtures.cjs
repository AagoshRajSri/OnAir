const fs = require('fs')
const path = require('path')

const fixturesDir = path.join(__dirname, '../fixtures')
if (!fs.existsSync(fixturesDir)) {
  fs.mkdirSync(fixturesDir, { recursive: true })
}

// 1. UTF-8 TXT
fs.writeFileSync(
  path.join(fixturesDir, 'sample-utf8.txt'),
  Buffer.from('\uFEFFHello from OnAir! This is a UTF-8 text file with accents: café, naïve, résumé.', 'utf8')
)

// 2. Windows-1252 TXT with accented characters
// In Windows-1252: é = 0xE9, ï = 0xEF, ü = 0xFC, ç = 0xE7
const win1252Buf = Buffer.from([
  0x43, 0x61, 0x66, 0xE9, 0x20, // "Café "
  0x6E, 0x61, 0xEF, 0x76, 0x65, 0x20, // "naïve "
  0xFC, 0x62, 0x65, 0x72, 0x20, // "über "
  0x66, 0x61, 0xE7, 0x61, 0x64, 0x65 // "façade"
])
fs.writeFileSync(path.join(fixturesDir, 'sample-windows1252.txt'), win1252Buf)

// 3. PNG file (1x1 transparent PNG)
const pngBuf = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89, 0x00, 0x00, 0x00, 0x0a, 0x49, 0x44, 0x41,
  0x54, 0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00,
  0x05, 0x00, 0x01, 0x0d, 0x0a, 0x2d, 0xb4, 0x00,
  0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae,
  0x42, 0x60, 0x82
])
fs.writeFileSync(path.join(fixturesDir, 'sample.png'), pngBuf)

// 4. Oversized file (> 10 MB = 10,485,760 bytes)
// 10,485,761 bytes
const oversized = Buffer.alloc(10485761, 65) // 'A' repeated
fs.writeFileSync(path.join(fixturesDir, 'sample-oversized.txt'), oversized)

// 5. Scanned PDF mock (minimal PDF header with no text)
const emptyPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R >> endobj
4 0 obj << /Length 12 >> stream
BT
/F1 12 Tf
ET
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000216 00000 n 
trailer << /Size 5 /Root 1 0 R >>
startxref
279
%%EOF`
fs.writeFileSync(path.join(fixturesDir, 'sample-scanned.pdf'), emptyPdf)

// 6. Text PDF mock (PDF with selectable text)
const textPdf = `%PDF-1.4
1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj
2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj
3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj
4 0 obj << /Length 73 >> stream
BT
/F1 12 Tf
72 712 Td
(OnAir floating reader companion text test. This has plenty of characters.) Tj
ET
endstream
endobj
5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000250 00000 n 
0000000374 00000 n 
trailer << /Size 6 /Root 1 0 R >>
startxref
452
%%EOF`
fs.writeFileSync(path.join(fixturesDir, 'sample-text.pdf'), textPdf)

console.log('Fixtures generated successfully!')

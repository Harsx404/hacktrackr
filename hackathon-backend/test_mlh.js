const fs = require('fs');
fetch('https://www.mlh.com/seasons/2026/events')
  .then(r => r.text())
  .then(h => {
    const match = h.match(/data-page="([^"]+)"/);
    if(match) {
      // Decode HTML entities
      const decoded = match[1].replace(/&quot;/g, '"');
      const data = JSON.parse(decoded);
      fs.writeFileSync('mlh-inertia.json', JSON.stringify(data, null, 2));
      console.log('Saved to mlh-inertia.json');
    } else {
      console.log('No data-page found');
    }
  }).catch(console.error);

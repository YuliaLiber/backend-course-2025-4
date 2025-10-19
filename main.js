// main.js (robust JSON/NDJSON reader, fast-xml-parser v5)
const http = require('http');
const fs = require('fs');
const { program } = require('commander');
const { XMLBuilder } = require('fast-xml-parser');
const { URL } = require('url');
const path = require('path');

program
  .requiredOption('-i, --input <path>', 'path to input JSON file')
  .requiredOption('-h, --host <host>', 'server host')
  .requiredOption('-p, --port <port>', 'server port');

program.parse(process.argv);
const opts = program.opts();

const inputFile = opts.input;
const host = opts.host;
const port = Number(opts.port);

if (!fs.existsSync(inputFile)) {
  console.error('Cannot find input file');
  process.exit(1);
}

const xmlBuilder = new XMLBuilder({ format: true, indentBy: '  ' });

function findRecords(obj) {
  if (Array.isArray(obj)) return obj;
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (Array.isArray(v)) return v;
      if (v && typeof v === 'object') {
        const nested = findRecords(v);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

// Спроба №1: звичайний JSON.parse
function tryParseAsJSONArray(text) {
  try {
    const json = JSON.parse(text);
    return findRecords(json);
  } catch {
    return null;
  }
}

// Спроба №2: NDJSON (кожен рядок — окремий JSON-об’єкт)
function tryParseAsNDJSON(text) {
  const lines = text.split(/\r?\n/).filter(Boolean);
  const out = [];
  for (const line of lines) {
    try {
      const obj = JSON.parse(line);
      out.push(obj);
    } catch {
      // якщо рядок не JSON — ігноруємо
    }
  }
  return out.length ? out : null;
}

const server = http.createServer(async (req, res) => {
  try {
    const fullUrl = new URL(req.url, `http://${host}:${port}`);
    const showDate = fullUrl.searchParams.get('date') === 'true';
    const airtimeMinParam = fullUrl.searchParams.get('airtime_min');
    const airtimeMin = airtimeMinParam ? Number(airtimeMinParam) : null;

    let content;
    try {
      content = await fs.promises.readFile(inputFile, 'utf8');
      // прибираємо можливий BOM
      if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1);
    } catch {
      console.error('Cannot find input file');
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Cannot find input file');
      return;
    }

    // Парсимо: JSON масив → якщо ні, тоді NDJSON
    let records = tryParseAsJSONArray(content);
    if (!records) {
      records = tryParseAsNDJSON(content);
    }
    if (!records) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid JSON');
      return;
    }

    // Фільтрація за airtime_min
    const filtered = records.filter(r => {
      const at = r?.AIR_TIME ?? r?.air_time ?? r?.AirTime ?? null;
      if (airtimeMin != null) {
        return at != null && Number(at) > airtimeMin;
      }
      return true;
    });

    // Формуємо об’єкти для XML
    const xmlFlights = filtered.map(r => {
      const obj = {};
      const dateVal = r.FL_DATE ?? r.date;
      const airVal = r.AIR_TIME ?? r.air_time ?? r.AirTime;
      const distVal = r.DISTANCE ?? r.distance ?? r.Distance;
      if (showDate && dateVal != null) obj.date = String(dateVal);
      if (airVal != null) obj.air_time = String(airVal);
      if (distVal != null) obj.distance = String(distVal);
      return obj;
    });

    const xml = xmlBuilder.build({ flights: { flight: xmlFlights } });

    const outPath = path.join(process.cwd(), 'output.xml');
    await fs.promises.writeFile(outPath, xml, 'utf8');

    res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8' });
    res.end(xml);
  } catch (err) {
    console.error('Server error:', err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Internal server error');
  }
});

server.listen(port, host, () => {
  console.log(`Server listening at http://${host}:${port}`);
});

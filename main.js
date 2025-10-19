// main.js
// Варіант 2 — flights-1m.json
// Приймає параметри: -i (input), -h (host), -p (port)

const http = require('http');
const fs = require('fs');
const { program } = require('commander');
const { j2xParser } = require('fast-xml-parser');
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

const xmlBuilder = new j2xParser({ format: true, indentBy: '  ' });

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

const server = http.createServer(async (req, res) => {
  try {
    const fullUrl = new URL(req.url, `http://${host}:${port}`);
    const showDate = fullUrl.searchParams.get('date') === 'true';
    const airtimeMinParam = fullUrl.searchParams.get('airtime_min');
    const airtimeMin = airtimeMinParam ? Number(airtimeMinParam) : null;

    let content;
    try {
      content = await fs.promises.readFile(inputFile, 'utf8');
    } catch (e) {
      console.error('Cannot find input file');
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Cannot find input file');
      return;
    }

    let json;
    try {
      json = JSON.parse(content);
    } catch {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Invalid JSON');
      return;
    }

    const records = findRecords(json);

    const filtered = records.filter(r => {
      const at = r?.AIR_TIME ?? r?.air_time ?? r?.AirTime ?? null;
      if (airtimeMin != null) {
        return at != null && Number(at) > airtimeMin;
      }
      return true;
    });

    const xmlFlights = filtered.map(r => {
      const obj = {};
      if (showDate && (r.FL_DATE || r.date)) obj.date = r.FL_DATE || r.date;
      if (r.AIR_TIME || r.air_time) obj.air_time = r.AIR_TIME || r.air_time;
      if (r.DISTANCE || r.distance) obj.distance = r.DISTANCE || r.distance;
      return obj;
    });

    const xml = xmlBuilder.parse({ flights: { flight: xmlFlights } });

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

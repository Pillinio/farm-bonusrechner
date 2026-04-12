#!/usr/bin/env node
// parse-kml.js — Parses Erichsfelde KML and outputs SQL INSERTs for farm_camps
// Usage: node scripts/parse-kml.js > output.sql

const fs = require('fs');
const path = require('path');

const KML_PATH = path.join(__dirname, '..', 'Data_Input', 'Okt. 2025 Erichsfelde NS.kmz.kml');

// ---------------------------------------------------------------------------
// Minimal XML helpers (no dependencies)
// ---------------------------------------------------------------------------

function readFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }
  return fs.readFileSync(filePath, 'utf-8');
}

/** Return content of the first <tag>…</tag> inside `xml`, or null. */
function tagContent(xml, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`);
  const m = xml.match(re);
  return m ? m[1] : null;
}

/** Return an array of raw strings for every <tag …>…</tag> occurrence. */
function allTags(xml, tag) {
  const results = [];
  const openTag = `<${tag}`;
  const closeTag = `</${tag}>`;
  let pos = 0;
  while (true) {
    const start = xml.indexOf(openTag, pos);
    if (start === -1) break;
    const end = xml.indexOf(closeTag, start);
    if (end === -1) break;
    results.push(xml.slice(start, end + closeTag.length));
    pos = end + closeTag.length;
  }
  return results;
}

/** Non-greedy: find the first <tag>…</tag> and return its inner text (trimmed). */
function firstTagText(xml, tag) {
  const c = tagContent(xml, tag);
  return c ? c.trim() : null;
}

// ---------------------------------------------------------------------------
// KML coordinate parsing
// ---------------------------------------------------------------------------

/** Parse KML coordinate string "lon,lat,alt lon,lat,alt …" into [[lon,lat], …] */
function parseCoordinates(coordStr) {
  return coordStr
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(tuple => {
      const [lon, lat] = tuple.split(',').map(Number);
      return [lon, lat];
    });
}

/** Convert a ring (array of [lon,lat]) to WKT ring string. */
function ringToWkt(ring) {
  return ring.map(([lon, lat]) => `${lon} ${lat}`).join(',');
}

/** Build WKT MultiPolygon from an array of polygons.
 *  Each polygon is { outer: [[lon,lat],...], inner: [[[lon,lat],...], ...] }
 */
function toMultiPolygonWkt(polygons) {
  const polyStrs = polygons.map(p => {
    const rings = [`(${ringToWkt(p.outer)})`];
    for (const inner of (p.inner || [])) {
      rings.push(`(${ringToWkt(inner)})`);
    }
    return `(${rings.join(',')})`;
  });
  return `MULTIPOLYGON(${polyStrs.join(',')})`;
}

/** Extract polygons from a Placemark XML string.
 *  Returns array of { outer, inner } objects, one per <Polygon>.
 */
function extractPolygons(placemarkXml) {
  const polygons = [];
  const polyTags = allTags(placemarkXml, 'Polygon');
  for (const polyXml of polyTags) {
    const outerCoord = tagContent(polyXml, 'outerBoundaryIs');
    if (!outerCoord) continue;
    const outerRingCoord = firstTagText(outerCoord, 'coordinates');
    if (!outerRingCoord) continue;
    const outer = parseCoordinates(outerRingCoord);
    if (outer.length < 4) continue; // need at least a triangle + closing point

    const innerRings = [];
    const innerBounds = allTags(polyXml, 'innerBoundaryIs');
    for (const ib of innerBounds) {
      const ic = firstTagText(ib, 'coordinates');
      if (ic) innerRings.push(parseCoordinates(ic));
    }
    polygons.push({ outer, inner: innerRings });
  }
  return polygons;
}

// ---------------------------------------------------------------------------
// Area estimation (Shoelace formula on lon/lat, then approximate m²)
// ---------------------------------------------------------------------------

/** Approximate area of a polygon ring in hectares using the Shoelace formula
 *  with a cos(lat) correction for longitude. Good enough for Namibia (~21°S). */
function ringAreaHa(ring) {
  const DEG_TO_M_LAT = 111_320; // meters per degree latitude
  const midLat = ring.reduce((s, [, lat]) => s + lat, 0) / ring.length;
  const cosLat = Math.cos((midLat * Math.PI) / 180);
  const DEG_TO_M_LON = DEG_TO_M_LAT * cosLat;

  let area = 0;
  for (let i = 0; i < ring.length; i++) {
    const j = (i + 1) % ring.length;
    const xi = ring[i][0] * DEG_TO_M_LON;
    const yi = ring[i][1] * DEG_TO_M_LAT;
    const xj = ring[j][0] * DEG_TO_M_LON;
    const yj = ring[j][1] * DEG_TO_M_LAT;
    area += xi * yj - xj * yi;
  }
  return Math.abs(area / 2) / 10_000; // m² → ha
}

// ---------------------------------------------------------------------------
// Folder / hierarchy traversal
// ---------------------------------------------------------------------------

/**
 * Walk the "Kamps" folder tree.  Each <Folder> inside "Kamps" is a parent camp.
 * Placemarks with <Polygon> inside that folder are sub-camps (or the camp itself
 * when there is only one).
 *
 * Returns: [{ name, parentCamp, polygons: [{outer, inner}], areaHa }]
 */
function walkKampsFolder(kampsXml) {
  const results = [];

  // Split into child Folders and loose Placemarks
  const childFolders = allTags(kampsXml, 'Folder');
  // Also grab any Placemarks directly in Kamps (not inside a sub-Folder)
  // We'll process them after folders to avoid double-counting

  for (const folderXml of childFolders) {
    const folderName = firstTagText(folderXml, 'name');

    // Find Placemarks inside this folder that have Polygons
    const placemarks = allTags(folderXml, 'Placemark');
    for (const pm of placemarks) {
      const pmName = firstTagText(pm, 'name');
      const polys = extractPolygons(pm);
      if (polys.length === 0) continue; // skip LineString / Point placemarks

      let areaHa = 0;
      for (const p of polys) {
        areaHa += ringAreaHa(p.outer);
        for (const inner of (p.inner || [])) {
          areaHa -= ringAreaHa(inner);
        }
      }

      results.push({
        name: pmName || folderName,
        parentCamp: folderName,
        polygons: polys,
        areaHa,
      });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const xml = readFile(KML_PATH);

  const allCamps = [];

  // --- 1. Find the "Kamps" folder under Erichsfelde -----------------------
  // Locate by searching for <name>Kamps</name> inside a Folder
  const kampsFolderMatch = xml.match(
    /<Folder[^>]*>\s*<name>Kamps<\/name>([\s\S]*?)(?=<Folder[^>]*>\s*<name>Wildsichere Kamps<\/name>)/
  );
  if (kampsFolderMatch) {
    const kampsContent = kampsFolderMatch[1];
    const camps = walkKampsFolder(kampsContent);
    allCamps.push(...camps);
  }

  // --- 2. Wildsichere Kamps ------------------------------------------------
  const wildMatch = xml.match(
    /<Folder[^>]*>\s*<name>Wildsichere Kamps<\/name>([\s\S]*?)<\/Folder>\s*(?:<Placemark|<Folder)/
  );
  if (wildMatch) {
    const placemarks = allTags(wildMatch[0], 'Placemark');
    for (const pm of placemarks) {
      const pmName = firstTagText(pm, 'name');
      const polys = extractPolygons(pm);
      if (polys.length === 0) continue;
      let areaHa = 0;
      for (const p of polys) {
        areaHa += ringAreaHa(p.outer);
        for (const inner of (p.inner || [])) areaHa -= ringAreaHa(inner);
      }
      allCamps.push({
        name: pmName,
        parentCamp: 'Wildsichere Kamps',
        polygons: polys,
        areaHa,
      });
    }
  }

  // --- 3. Außengrenze Farm (farm boundary, not a camp but useful) ----------
  const farmBoundaryMatch = xml.match(
    /<Placemark[^>]*>\s*<name>Außengrenze Farm<\/name>[\s\S]*?<\/Placemark>/
  );
  if (farmBoundaryMatch) {
    const polys = extractPolygons(farmBoundaryMatch[0]);
    if (polys.length > 0) {
      let areaHa = 0;
      for (const p of polys) {
        areaHa += ringAreaHa(p.outer);
        for (const inner of (p.inner || [])) areaHa -= ringAreaHa(inner);
      }
      allCamps.push({
        name: 'Außengrenze Farm',
        parentCamp: null,
        polygons: polys,
        areaHa,
      });
    }
  }

  // --- Output SQL ----------------------------------------------------------
  const totalArea = allCamps.reduce((s, c) => s + c.areaHa, 0);
  const farmBoundary = allCamps.find(c => c.name === 'Außengrenze Farm');
  const campsOnly = allCamps.filter(c => c.name !== 'Außengrenze Farm');

  const lines = [];
  lines.push('-- ============================================================');
  lines.push(`-- Erichsfelde farm_camps import`);
  lines.push(`-- Generated: ${new Date().toISOString()}`);
  lines.push(`-- Source:     ${path.basename(KML_PATH)}`);
  lines.push(`-- Camps found:         ${campsOnly.length}`);
  if (farmBoundary) {
    lines.push(`-- Farm boundary area:  ${farmBoundary.areaHa.toFixed(0)} ha (${(farmBoundary.areaHa / 100).toFixed(1)} km²)`);
  }
  lines.push(`-- Total camp area:     ${campsOnly.reduce((s, c) => s + c.areaHa, 0).toFixed(0)} ha`);
  lines.push('-- ============================================================');
  lines.push('');

  // Helper to escape single quotes in SQL strings
  const esc = s => (s || '').replace(/'/g, "''");

  for (const camp of allCamps) {
    const wkt = toMultiPolygonWkt(camp.polygons);
    const parentVal = camp.parentCamp ? `'${esc(camp.parentCamp)}'` : 'NULL';
    const purpose = camp.name === 'Außengrenze Farm' ? "'boundary'" : 'NULL';

    lines.push(`-- ${camp.name} (~${camp.areaHa.toFixed(0)} ha)`);
    lines.push(
      `INSERT INTO farm_camps (name, parent_camp, geom, purpose) VALUES (` +
        `'${esc(camp.name)}', ${parentVal}, ` +
        `ST_GeomFromText('${wkt}', 4326), ` +
        `${purpose});`
    );
    lines.push('');
  }

  console.log(lines.join('\n'));
}

main();

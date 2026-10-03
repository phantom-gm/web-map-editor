/* Dependency-free ZIP32 store writer. No filesystem access. */
'use strict';
const MAX_ZIP_BYTES = 128 * 1024 * 1024;
const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let bit = 0; bit < 8; bit++) n = (n >>> 1) ^ ((n & 1) ? 0xedb88320 : 0);
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 255];
  return (crc ^ 0xffffffff) >>> 0;
}
function createStoredZip(entries, date = new Date()) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 65535) throw new Error('Invalid ZIP entry count.');
  const names = new Set(); let estimated = 22;
  for (const entry of entries) {
    if (!entry || typeof entry.name !== 'string' || !entry.name || entry.name.includes('\\') || entry.name.includes(':') || entry.name.includes('\0') ||
      entry.name.split('/').some(part => !part || part === '.' || part === '..') || names.has(entry.name) || !Buffer.isBuffer(entry.bytes)) throw new Error('Unsafe ZIP entry.');
    const length = Buffer.byteLength(entry.name);
    if (length > 65535 || entry.bytes.length > 0xffffffff) throw new Error('ZIP64 is not supported.');
    names.add(entry.name); estimated += 30 + 46 + length * 2 + entry.bytes.length;
    if (!Number.isSafeInteger(estimated) || estimated > MAX_ZIP_BYTES || estimated > 0xffffffff) throw new Error('ZIP exceeds the 128 MiB size limit.');
  }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw new Error('Invalid ZIP date.');
  const year = Math.max(1980, Math.min(2107, date.getUTCFullYear()));
  const dosTime = (date.getUTCHours() << 11) | (date.getUTCMinutes() << 5) | (date.getUTCSeconds() >> 1);
  const dosDate = ((year - 1980) << 9) | ((date.getUTCMonth() + 1) << 5) | date.getUTCDate();
  const parts = [], central = []; let offset = 0, centralSize = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8'), size = entry.bytes.length, crc = crc32(entry.bytes);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(dosTime, 10); local.writeUInt16LE(dosDate, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22); local.writeUInt16LE(name.length, 26);
    parts.push(local, name, entry.bytes);
    const item = Buffer.alloc(46);
    item.writeUInt32LE(0x02014b50, 0); item.writeUInt16LE(20, 4); item.writeUInt16LE(20, 6); item.writeUInt16LE(0x800, 8);
    item.writeUInt16LE(dosTime, 12); item.writeUInt16LE(dosDate, 14); item.writeUInt32LE(crc, 16);
    item.writeUInt32LE(size, 20); item.writeUInt32LE(size, 24); item.writeUInt16LE(name.length, 28); item.writeUInt32LE(offset, 42);
    central.push(item, name); centralSize += item.length + name.length; offset += local.length + name.length + size;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralSize, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end], estimated);
}
module.exports = { createStoredZip, crc32, MAX_ZIP_BYTES };

'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const sensitive = name => path.basename(name.replace(/\\/g, '/')) === 'DT_ServerSecret.csv';
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

/** Remove only redundant secret CSV copies; retain source game data and editor projects. */
function pruneSensitiveReferences(syncRoot, { apply = false } = {}) {
  const root = path.resolve(syncRoot);
  if (!fs.existsSync(root)) return { copies: 0, metadataFiles: 0, applied: false };
  const files = [];
  function visit(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error('링크가 있는 보관 폴더는 자동 정리하지 않습니다: ' + file);
      if (entry.isDirectory()) visit(file); else if (entry.isFile()) files.push(file);
    }
  }
  if (fs.lstatSync(root).isSymbolicLink()) throw new Error('링크 폴더는 자동 정리하지 않습니다.');
  visit(root);
  const copies = files.filter(file => sensitive(file) && /(^|\/)\b(reference|snapshot)\//.test(path.relative(root, file).replace(/\\/g, '/')));
  const updates = new Map(), baselineHashes = new Map();
  const readJson = file => JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  const update = (file, value) => updates.set(file, { before: fs.readFileSync(file), after: jsonBytes(value) });
  for (const file of files.filter(file => /^baselines\/[a-f0-9-]+\/manifest\.json$/.test(path.relative(root, file).replace(/\\/g, '/')))) {
    const before = fs.readFileSync(file), m = readJson(file);
    const removed = m.sourceFiles.filter(item => sensitive(item.relative));
    if (removed.length) {
      for (const item of removed.filter(item => item.exists)) {
        const copy = path.join(path.dirname(file), 'snapshot', item.relative);
        if (!copies.includes(copy) || hash(fs.readFileSync(copy)) !== item.sha256) throw new Error('정리할 기준 사본의 무결성이 다릅니다: ' + copy);
      }
      m.sourceFiles = m.sourceFiles.filter(item => !sensitive(item.relative));
      m.datasetFiles = m.datasetFiles.filter(item => !sensitive(item));
      update(file, m);
    }
    baselineHashes.set(m.baselineId, { before: hash(before), after: hash(updates.get(file)?.after ?? before), accepted: new Set([hash(before)]) });
  }
  // A previous interrupted/older cleanup can be repaired only from its exact metadata journal.
  for (const file of files.filter(file => /^maintenance\/secret-reference-[^/]+\/baselines\/[a-f0-9-]+\/manifest\.json$/.test(path.relative(root, file).replace(/\\/g, '/')))) {
    const original = fs.readFileSync(file), m = readJson(file), basis = baselineHashes.get(m.baselineId);
    if (!basis) continue;
    m.sourceFiles = m.sourceFiles.filter(item => !sensitive(item.relative));
    m.datasetFiles = m.datasetFiles.filter(item => !sensitive(item));
    if (hash(jsonBytes(m)) === basis.after) basis.accepted.add(hash(original));
  }
  for (const file of files.filter(file => /^baselines\/(npc|runtime)-[a-f0-9-]+\/manifest\.json$/.test(path.relative(root, file).replace(/\\/g, '/')))) {
    const m = readJson(file), basis = baselineHashes.get(m.baselineId);
    if (basis && basis.accepted.has(m.baselineManifestSha256) && m.baselineManifestSha256 !== basis.after) {
      m.baselineManifestSha256 = basis.after; update(file, m);
    }
  }
  for (const file of files.filter(file => path.basename(file) === 'review-manifest.json' && path.relative(root, file).startsWith('candidates' + path.sep))) {
    const m = readJson(file), basis = baselineHashes.get(m.baselineId);
    const removed = m.referenceFiles.filter(item => sensitive(item.path));
    if (!removed.length && (!basis || m.baselineManifestSha256 === basis.after)) continue;
    if (basis && !basis.accepted.has(m.baselineManifestSha256)) continue; // Preserve already-invalid records for diagnosis.
    for (const item of removed) {
      const copy = path.join(path.dirname(file), item.path);
      if (!copies.includes(copy) || hash(fs.readFileSync(copy)) !== item.sha256) throw new Error('정리할 후보 사본의 무결성이 다릅니다: ' + copy);
    }
    const reportPath = path.join(path.dirname(file), 'report.json'), report = readJson(reportPath);
    if (hash(fs.readFileSync(reportPath)) !== m.report.sha256) throw new Error('후보 보고서가 변경되어 정리를 중단했습니다: ' + reportPath);
    m.referenceFiles = m.referenceFiles.filter(item => !sensitive(item.path));
    if (basis) m.baselineManifestSha256 = basis.after;
    report.datasetFilesCopied = m.referenceFiles.length;
    if (report.datasetChangesSinceBaseline) report.datasetChangesSinceBaseline = report.datasetChangesSinceBaseline.filter(item => !sensitive(item.path));
    update(reportPath, report);
    m.report.bytes = updates.get(reportPath).after.length;
    m.report.sha256 = hash(updates.get(reportPath).after);
    update(file, m);
  }
  const plan = { copies: copies.length, metadataFiles: updates.size, applied: apply };
  if (!apply || (!copies.length && !updates.size)) return plan;
  // Verify every destination again before any mutation. Recovery metadata never includes CSV contents.
  const copyHashes = new Map(copies.map(file => [file, hash(fs.readFileSync(file))]));
  for (const [file, item] of updates) if (!fs.readFileSync(file).equals(item.before)) throw new Error('정리 중 기록이 바뀌었습니다: ' + file);
  const recovery = path.join(root, 'maintenance', 'secret-reference-' + crypto.randomUUID());
  for (const [file, item] of updates) {
    const backup = path.join(recovery, path.relative(root, file));
    fs.mkdirSync(path.dirname(backup), { recursive: true }); fs.writeFileSync(backup, item.before, { flag: 'wx' });
    const temp = file + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, item.after, { flag: 'wx' }); fs.renameSync(temp, file);
  }
  for (const [file, expected] of copyHashes) {
    if (hash(fs.readFileSync(file)) !== expected) throw new Error('정리 중 사본이 바뀌었습니다: ' + file);
    fs.unlinkSync(file);
  }
  return plan;
}
module.exports = { pruneSensitiveReferences };
if (require.main === module) console.log(JSON.stringify(pruneSensitiveReferences(path.resolve(__dirname, '../../.game-sync'), { apply: process.argv.includes('--apply') })));

#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createSyncProject, exportEditedProject, inspectSyncProject } = require('./core.cjs');

function args(argv) {
  const out = { command: argv[0] };
  for (let i = 1; i < argv.length; i++) {
    const name = argv[i];
    if (!['--game-root', '--map', '--baseline-root', '--output-root', '--project'].includes(name)) throw new Error('알 수 없는 인자: ' + name);
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw new Error(name + ' 값이 필요합니다.');
    out[name.slice(2)] = value;
  }
  return out;
}
function main(argv) {
  if (!argv.length || argv.includes('--help')) {
    console.log([
      'Game sync: 게임 원본은 읽고, 기준/후보 파일은 게임 밖에만 저장합니다.',
      '  create --game-root <게임폴더> --map <맵이름> --baseline-root <기준폴더>',
      '  inspect --game-root <게임폴더> --project <동기화프로젝트.json> --baseline-root <기준폴더>',
      '  export --game-root <게임폴더> --project <동기화프로젝트.json> --baseline-root <기준폴더> --output-root <후보폴더>',
      '  후보 출력은 게임 반영이나 Maker 실플레이 검증을 수행하지 않습니다.'
    ].join('\n'));
    return;
  }
  const a = args(argv);
  for (const name of ['game-root', 'baseline-root']) if (!a[name]) throw new Error('--' + name + ' 값이 필요합니다.');
  const options = { gameRoot: path.resolve(a['game-root']), baselineRoot: path.resolve(a['baseline-root']) };
  if (a.command === 'create') {
    if (!a.map) throw new Error('--map 값이 필요합니다.');
    const result = createSyncProject({ ...options, mapName: a.map });
    console.log(JSON.stringify({ projectPath: result.projectPath, baselineDir: result.baselineDir, report: result.report }, null, 2));
  } else if (a.command === 'export' || a.command === 'inspect') {
    if (!a.project) throw new Error('--project 값이 필요합니다.');
    const project = JSON.parse(fs.readFileSync(path.resolve(a.project), 'utf8').replace(/^\uFEFF/, ''));
    if (a.command === 'inspect') {
      console.log(JSON.stringify(inspectSyncProject(project, options).report, null, 2));
    } else {
      if (!a['output-root']) throw new Error('--output-root 값이 필요합니다.');
      console.log(JSON.stringify(exportEditedProject(project, { ...options, outputRoot: path.resolve(a['output-root']) }), null, 2));
    }
  } else throw new Error('명령은 create, inspect, export 중 하나여야 합니다.');
}
if (require.main === module) {
  try { main(process.argv.slice(2)); }
  catch (e) { console.error(JSON.stringify({ error: e.code || e.name, message: e.message })); process.exitCode = 1; }
}
module.exports = { args, main };

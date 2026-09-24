'use strict';
// Exporta registros de um mes especifico para CSV, com filtro opcional por NNATOPE, para
// inspecao linha a linha (ex: comparar com o proprio sistema FAT quando ha suspeita de
// categorizacao errada).
//
// Uso:
//   node tools/exportar-csv.js "<dbf>" <ano> <mes> <campo_data> <campos_separados_por_virgula> [natope_filtro_ou_-] [campo_cancelamento_ou_-] [arquivo_saida.csv]
//
// Exemplo (so as notas 1.102 e 1.403 de dezembro no ftentr):
//   node tools/exportar-csv.js "G:\Zimmer\ftentr.dbf" 2025 12 NDTENTR NNRNOTA,NDTEMIS,NDTENTR,NNATOPE,NTOTNOT,NTOTMER,NCODCLI,NNOMCLI 1.102,1.403 - entr_1102_1403.csv

const fs = require('fs');
const { scan } = require('../src/dbf-reader');
const { parseBrDate, parseNum } = require('../src/dbf-utils');

const [, , dbfPath, anoArg, mesArg, dateFieldArg, camposArg, natopeFiltroArg, cancelFieldArg, outArg] = process.argv;

if (!dbfPath || !anoArg || !mesArg || !dateFieldArg || !camposArg) {
  console.log('Uso: node tools/exportar-csv.js "<dbf>" <ano> <mes> <campo_data> <campos_separados_por_virgula> [natope_filtro_ou_-] [campo_cancelamento_ou_-] [arquivo_saida.csv]');
  console.log('Exemplo: node tools/exportar-csv.js "G:\\Zimmer\\ftentr.dbf" 2025 12 NDTENTR NNRNOTA,NDTEMIS,NDTENTR,NNATOPE,NTOTNOT,NTOTMER 1.102,1.403 - entr_1102_1403.csv');
  process.exit(1);
}

const ano = Number(anoArg);
const mes = Number(mesArg);
const dateField = dateFieldArg;
const campos = camposArg.split(',').map((s) => s.trim());
const natopeFiltro = (natopeFiltroArg && natopeFiltroArg !== '-') ? natopeFiltroArg.split(',').map((s) => s.trim()) : null;
const cancelField = (cancelFieldArg && cancelFieldArg !== '-') ? cancelFieldArg : null;
const outPath = outArg || ('export_' + ano + '_' + String(mes).padStart(2, '0') + '.csv');

const wanted = [dateField, 'NNATOPE'].concat(cancelField ? [cancelField] : []).concat(campos);
const linhas = [campos.join(';')];
let count = 0;

console.log('Lendo ' + dbfPath + ' ...');
const t0 = Date.now();

scan(dbfPath, wanted, (rec) => {
  if (rec.__deleted) return;
  if (cancelField && rec[cancelField] && rec[cancelField].trim() !== '') return;
  const d = parseBrDate(rec[dateField]);
  if (!d || d.getFullYear() !== ano || (d.getMonth() + 1) !== mes) return;

  const nat = (rec.NNATOPE || '').trim();
  if (natopeFiltro && !natopeFiltro.includes(nat)) return;

  count++;
  linhas.push(campos.map((c) => String(rec[c] == null ? '' : rec[c]).replace(/;/g, ',')).join(';'));
});

fs.writeFileSync(outPath, '\uFEFF' + linhas.join('\n'), 'utf8');

const ms = Date.now() - t0;
console.log('Lido em ' + (ms / 1000).toFixed(1) + 's.');
console.log(count + ' registros exportados para: ' + outPath);

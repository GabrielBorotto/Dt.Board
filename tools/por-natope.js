'use strict';
// Agrupa os valores de um mes especifico POR NNATOPE (provavel campo de CFOP/natureza da
// operacao), para comparar linha a linha com um relatorio por CFOP do proprio sistema FAT.
//
// Uso:
//   node tools/por-natope.js "<dbf>" <ano> <mes> <campo_data> <campos_somar_separados_por_virgula> [campo_cancelamento]
//
// Exemplo (ftentr, comparando com o relatorio "RESUMO IMPOSTOS ENTRADA X SAIDA"):
//   node tools/por-natope.js "G:\Zimmer\ftentr.dbf" 2025 12 NDTEMIS NTOTNOT,NVALICM,NVALPIS,NVALFIN,NVALIST,NVALINT
//
// Exemplo (ftnota):
//   node tools/por-natope.js "G:\Zimmer\ftnota.dbf" 2025 12 NDTEMIS NTOTFAT,NVALICM,NVALICM1,NPISNOT,NCOFNOT NDTCANC

const { scan } = require('../src/dbf-reader');
const { parseBrDate, parseNum } = require('../src/dbf-utils');

const [, , dbfPath, anoArg, mesArg, dateFieldArg, camposArg, cancelFieldArg] = process.argv;

if (!dbfPath || !anoArg || !mesArg || !dateFieldArg || !camposArg) {
  console.log('Uso: node tools/por-natope.js "<dbf>" <ano> <mes> <campo_data> <campos_separados_por_virgula> [campo_cancelamento]');
  console.log('Exemplo: node tools/por-natope.js "G:\\Zimmer\\ftentr.dbf" 2025 12 NDTEMIS NTOTNOT,NVALICM,NVALPIS,NVALFIN,NVALIST,NVALINT');
  process.exit(1);
}

const ano = Number(anoArg);
const mes = Number(mesArg);
const dateField = dateFieldArg;
const campos = camposArg.split(',').map((s) => s.trim());
const cancelField = cancelFieldArg || null;

const wanted = [dateField, 'NNATOPE'].concat(cancelField ? [cancelField] : []).concat(campos);
const grupos = {}; // NNATOPE -> { count, campo1: soma, campo2: soma, ... }
let totalGeral = { count: 0 };
campos.forEach((c) => { totalGeral[c] = 0; });

console.log('Lendo ' + dbfPath + ' ...');
const t0 = Date.now();

scan(dbfPath, wanted, (rec) => {
  if (rec.__deleted) return;
  if (cancelField && rec[cancelField] && rec[cancelField].trim() !== '') return;
  const d = parseBrDate(rec[dateField]);
  if (!d || d.getFullYear() !== ano || (d.getMonth() + 1) !== mes) return;

  const nat = (rec.NNATOPE || '(vazio)').trim() || '(vazio)';
  if (!grupos[nat]) {
    grupos[nat] = { count: 0 };
    campos.forEach((c) => { grupos[nat][c] = 0; });
  }
  grupos[nat].count += 1;
  totalGeral.count += 1;
  campos.forEach((c) => {
    const v = parseNum(rec[c]);
    grupos[nat][c] += v;
    totalGeral[c] += v;
  });
});

const ms = Date.now() - t0;
console.log('Lido em ' + (ms / 1000).toFixed(1) + 's.\n');

function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const nats = Object.keys(grupos).sort();
const header = 'NNATOPE'.padEnd(10) + 'qtd'.padStart(6) + '  ' + campos.map((c) => c.padStart(16)).join('  ');
console.log(header);
console.log('-'.repeat(header.length));
nats.forEach((nat) => {
  const g = grupos[nat];
  console.log(nat.padEnd(10) + String(g.count).padStart(6) + '  ' + campos.map((c) => fmt(g[c]).padStart(16)).join('  '));
});
console.log('-'.repeat(header.length));
console.log('TOTAL'.padEnd(10) + String(totalGeral.count).padStart(6) + '  ' + campos.map((c) => fmt(totalGeral[c]).padStart(16)).join('  '));

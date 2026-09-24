'use strict';
// Soma TODOS os campos numericos do arquivo para um mes especifico e mostra quais mais se
// aproximam de um valor "alvo" (tirado de um relatorio do proprio sistema FAT). Util para
// descobrir qual campo do dbf corresponde a um numero conhecido, sem precisar adivinhar
// nomes de campo.
//
// Uso:
//   node tools/buscar-campo.js "<caminho do dbf>" <ano> <mes> <valor_alvo> [campo_data] [campo_cancelamento]
//
// Exemplo (procurando o campo de ICMS de saida = 203187.41 em dezembro/2025):
//   node tools/buscar-campo.js "G:\Zimmer\ftnota.dbf" 2025 12 203187.41 NDTEMIS NDTCANC
//
// Exemplo no ftentr (sem campo de cancelamento):
//   node tools/buscar-campo.js "G:\Zimmer\ftentr.dbf" 2025 12 132006.88 NDTEMIS

const { readMeta, scan } = require('../src/dbf-reader');
const { parseBrDate, parseNum } = require('../src/dbf-utils');

const [, , dbfPath, anoArg, mesArg, alvoArg, dateFieldArg, cancelFieldArg] = process.argv;

if (!dbfPath || !anoArg || !mesArg || !alvoArg) {
  console.log('Uso: node tools/buscar-campo.js "<caminho do dbf>" <ano> <mes> <valor_alvo> [campo_data=NDTEMIS] [campo_cancelamento]');
  console.log('Exemplo: node tools/buscar-campo.js "G:\\Zimmer\\ftnota.dbf" 2025 12 203187.41 NDTEMIS NDTCANC');
  process.exit(1);
}

const ano = Number(anoArg);
const mes = Number(mesArg);
const alvo = Number(String(alvoArg).replace(',', '.'));
const dateField = dateFieldArg || 'NDTEMIS';
const cancelField = cancelFieldArg || null;

console.log('Lendo estrutura de ' + dbfPath + ' ...');
const meta = readMeta(dbfPath);
const numericFields = meta.fields.filter((f) => f.type === 'N').map((f) => f.name);
console.log(numericFields.length + ' campos numéricos encontrados. Somando cada um para ' +
  String(mes).padStart(2, '0') + '/' + ano + ' (por ' + dateField + (cancelField ? ', excluindo cancelado por ' + cancelField : '') + ') ...');
console.log('(isso pode demorar mais que os outros diagnósticos, pois lê todos os campos)\n');

const wanted = [dateField].concat(cancelField ? [cancelField] : []).concat(numericFields);
const sums = {};
numericFields.forEach((f) => { sums[f] = 0; });
let count = 0;

const t0 = Date.now();
scan(dbfPath, wanted, (rec) => {
  if (rec.__deleted) return;
  if (cancelField && rec[cancelField] && rec[cancelField].trim() !== '') return;
  const d = parseBrDate(rec[dateField]);
  if (!d || d.getFullYear() !== ano || (d.getMonth() + 1) !== mes) return;
  count++;
  numericFields.forEach((f) => { sums[f] += parseNum(rec[f]); });
});
const ms = Date.now() - t0;

console.log(count + ' registros somados em ' + (ms / 1000).toFixed(1) + 's.\n');

const results = numericFields.map((f) => ({ name: f, sum: sums[f], diff: Math.abs(sums[f] - alvo) }));
results.sort((a, b) => a.diff - b.diff);

function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

console.log('Valor alvo: ' + fmt(alvo));
console.log('Campos mais próximos (do mais perto para o mais longe):\n');
results.slice(0, 20).forEach((r) => {
  const marcador = r.diff < 0.01 ? '  <-- BATEU EXATO' : (r.diff < alvo * 0.02 ? '  <-- bem perto' : '');
  console.log('  ' + r.name.padEnd(14) + ' soma = ' + fmt(r.sum).padStart(18) + '   diferença = ' + fmt(r.diff) + marcador);
});

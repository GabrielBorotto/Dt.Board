'use strict';
// Ferramenta de diagnostico: soma o ftnota.dbf de varias formas diferentes para um mes
// especifico, para comparar linha por linha com o relatorio "Somador do Faturamento" do
// proprio sistema FAT e descobrir exatamente onde esta a diferenca.
//
// Uso:
//   node tools/diagnostico-nota.js "<caminho do ftnota.dbf>" <ano> <mes>
//
// Exemplo:
//   node tools/diagnostico-nota.js "G:\Zimmer\ftnota.dbf" 2025 12

const { scan } = require('../src/dbf-reader');
const { parseBrDate, parseNum } = require('../src/dbf-utils');

const [, , dbfPath, anoArg, mesArg] = process.argv;

if (!dbfPath || !anoArg || !mesArg) {
  console.log('Uso: node tools/diagnostico-nota.js "<caminho do ftnota.dbf>" <ano> <mes>');
  console.log('Exemplo: node tools/diagnostico-nota.js "G:\\Zimmer\\ftnota.dbf" 2025 12');
  process.exit(1);
}

const ano = Number(anoArg);
const mes = Number(mesArg);

const wanted = ['NDTEMIS', 'NDTSAID', 'NDTCANC', 'NDEVNOT', 'NTOTFAT', 'NVALICM', 'NVALICM1', 'NPISNOT', 'NCOFNOT'];

let totFatEmis = 0, totFatEmisSemDev = 0, totFatSaid = 0;
let icmsEmis = 0, icms1Emis = 0, pisEmis = 0, cofEmis = 0;
let devTotalEmis = 0;
let countEmis = 0, countCancel = 0, countDev = 0, countSaid = 0;

console.log('Lendo ' + dbfPath + ' ... (pode demorar um pouco, é um arquivo grande)');
const t0 = Date.now();

const meta = scan(dbfPath, wanted, (rec) => {
  if (rec.__deleted) return;
  const cancelada = rec.NDTCANC && rec.NDTCANC.trim() !== '';
  const dEmis = parseBrDate(rec.NDTEMIS);
  const dSaid = parseBrDate(rec.NDTSAID);
  const devolucao = rec.NDEVNOT && rec.NDEVNOT.trim() !== '';

  const noPeriodoEmis = dEmis && dEmis.getFullYear() === ano && (dEmis.getMonth() + 1) === mes;
  const noPeriodoSaid = dSaid && dSaid.getFullYear() === ano && (dSaid.getMonth() + 1) === mes;

  if (cancelada) {
    if (noPeriodoEmis) countCancel++;
    return; // segue excluindo canceladas de tudo, como o app ja faz
  }

  if (noPeriodoEmis) {
    countEmis++;
    const fat = parseNum(rec.NTOTFAT);
    totFatEmis += fat;
    icmsEmis += parseNum(rec.NVALICM);
    icms1Emis += parseNum(rec.NVALICM1);
    pisEmis += parseNum(rec.NPISNOT);
    cofEmis += parseNum(rec.NCOFNOT);
    if (devolucao) { countDev++; devTotalEmis += fat; } else { totFatEmisSemDev += fat; }
  }

  if (noPeriodoSaid && !cancelada) {
    countSaid++;
    totFatSaid += parseNum(rec.NTOTFAT);
  }
});

const ms = Date.now() - t0;

function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

console.log('Lido em ' + (ms / 1000).toFixed(1) + 's — ' + meta.numRecords + ' registros no arquivo total.\n');
console.log('=== Diagnóstico ' + String(mes).padStart(2, '0') + '/' + ano + ' ===\n');

console.log('Notas no período por NDTEMIS (não canceladas): ' + countEmis);
console.log('  das quais são devolução (NDEVNOT preenchido): ' + countDev);
console.log('Canceladas no período (excluídas de tudo)      : ' + countCancel);
console.log('Notas no período por NDTSAID (não canceladas)  : ' + countSaid);
console.log('');

console.log('--- Candidatos para "Valor do Faturamento" (FAT: confira o valor na tela) ---');
console.log('NTOTFAT somado por NDTEMIS, COM devoluções     : ' + fmt(totFatEmis));
console.log('NTOTFAT somado por NDTEMIS, SEM devoluções     : ' + fmt(totFatEmisSemDev));
console.log('NTOTFAT somado por NDTSAID (data de saída)     : ' + fmt(totFatSaid));
console.log('Soma das devoluções (NDEVNOT preenchido)       : ' + fmt(devTotalEmis) + '   <- compare com "Devolucoes" do FAT');
console.log('');

console.log('--- Candidatos para "Valor do ICMS" ---');
console.log('NVALICM sozinho                                : ' + fmt(icmsEmis));
console.log('NVALICM1 sozinho                                : ' + fmt(icms1Emis));
console.log('NVALICM + NVALICM1 (o que o app usa hoje)      : ' + fmt(icmsEmis + icms1Emis));
console.log('');

console.log('--- Candidatos para "Valor do PIS/COFINS" ---');
console.log('NPISNOT sozinho                                 : ' + fmt(pisEmis));
console.log('NCOFNOT sozinho                                  : ' + fmt(cofEmis));
console.log('NPISNOT + NCOFNOT                                : ' + fmt(pisEmis + cofEmis));
console.log('');

console.log('--- Conferência final (compare com a última linha do FAT) ---');
console.log('Faturamento(c/dev) - Devolução - (ICMS+ICMS1+PIS+COFINS): ' +
  fmt(totFatEmis - devTotalEmis - (icmsEmis + icms1Emis + pisEmis + cofEmis)));
console.log('Faturamento(c/dev) - Devolução - (ICMS somente+PIS+COFINS): ' +
  fmt(totFatEmis - devTotalEmis - (icmsEmis + pisEmis + cofEmis)));

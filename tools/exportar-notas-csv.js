'use strict';
// Exporta nota por nota de um mes especifico do ftnota.dbf para um arquivo CSV, para
// conferencia manual (abrir no Excel) contra o relatorio nativo do sistema FAT.
//
// Uso:
//   node tools/exportar-notas-csv.js "<caminho do ftnota.dbf>" <ano> <mes> [arquivo_saida.csv]
//
// Exemplo:
//   node tools/exportar-notas-csv.js "G:\Zimmer\ftnota.dbf" 2025 12 dezembro2025.csv

const fs = require('fs');
const { scan } = require('../src/dbf-reader');
const { parseBrDate, parseNum } = require('../src/dbf-utils');

const [, , dbfPath, anoArg, mesArg, outArg] = process.argv;

if (!dbfPath || !anoArg || !mesArg) {
  console.log('Uso: node tools/exportar-notas-csv.js "<caminho do ftnota.dbf>" <ano> <mes> [arquivo_saida.csv]');
  console.log('Exemplo: node tools/exportar-notas-csv.js "G:\\Zimmer\\ftnota.dbf" 2025 12 dezembro2025.csv');
  process.exit(1);
}

const ano = Number(anoArg);
const mes = Number(mesArg);
const outPath = outArg || ('notas_' + ano + '_' + String(mes).padStart(2, '0') + '.csv');

const wanted = [
  'NNRNOTA', 'NDTEMIS', 'NDTSAID', 'NDTCANC', 'NDEVNOT', 'NTIPNOT', 'NTIPDOC',
  'NCODCLI', 'NNOMCLI', 'NTOTFAT', 'NTOTMER', 'NVALICM', 'NVALICM1', 'NPISNOT', 'NCOFNOT',
];

const linhas = ['nota;data_emissao;data_saida;cancelada;devolucao;tipo_nota;tipo_doc;cod_cliente;nome_cliente;totfat;totmer;valicm;valicm1;pisnot;cofnot'];

let count = 0;
console.log('Lendo ' + dbfPath + ' ...');
const t0 = Date.now();

scan(dbfPath, wanted, (rec) => {
  if (rec.__deleted) return;
  const dEmis = parseBrDate(rec.NDTEMIS);
  if (!dEmis || dEmis.getFullYear() !== ano || (dEmis.getMonth() + 1) !== mes) return;

  count++;
  const cancelada = rec.NDTCANC && rec.NDTCANC.trim() !== '' ? 'SIM' : 'nao';
  const devolucao = rec.NDEVNOT && rec.NDEVNOT.trim() !== '' ? 'SIM' : 'nao';
  const nomeCli = (rec.NNOMCLI || '').replace(/;/g, ',');

  linhas.push([
    rec.NNRNOTA, rec.NDTEMIS, rec.NDTSAID, cancelada, devolucao,
    rec.NTIPNOT, rec.NTIPDOC, rec.NCODCLI, nomeCli,
    parseNum(rec.NTOTFAT).toFixed(2), parseNum(rec.NTOTMER).toFixed(2),
    parseNum(rec.NVALICM).toFixed(2), parseNum(rec.NVALICM1).toFixed(2),
    parseNum(rec.NPISNOT).toFixed(2), parseNum(rec.NCOFNOT).toFixed(2),
  ].join(';'));
});

fs.writeFileSync(outPath, '\uFEFF' + linhas.join('\n'), 'utf8'); // BOM para o Excel abrir acentos certinho

const ms = Date.now() - t0;
console.log('Lido em ' + (ms / 1000).toFixed(1) + 's.');
console.log(count + ' notas de ' + String(mes).padStart(2, '0') + '/' + ano + ' exportadas para: ' + outPath);
console.log('Abra esse arquivo no Excel (separador ";") para conferir nota a nota.');

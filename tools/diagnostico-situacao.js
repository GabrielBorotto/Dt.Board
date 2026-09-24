'use strict';
// Quebra o total de NTOTFAT (ftnota) por CADA combinacao de NSITPED + NDEVNOT dentro de um
// periodo - util para descobrir exatamente quais valores desses campos deveriam ser
// incluidos/excluidos para bater com um total esperado (ex: relatorio do FAT).
//
// Uso:
//   node tools/diagnostico-situacao.js "<caminho do ftnota.dbf>" <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplo:
//   node tools/diagnostico-situacao.js "G:\Zimmer\ftnota.dbf" 01/08/2026 31/08/2026

const { scan } = require('../src/dbf-reader');

const [, , dbfPath, deArg, ateArg] = process.argv;
if (!dbfPath || !deArg || !ateArg) {
  console.log('Uso: node tools/diagnostico-situacao.js "<ftnota.dbf>" <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}

function parseData(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const de = parseData(deArg), ate = parseData(ateArg);
if (!de || !ate) { console.log('Datas inválidas, use DD/MM/AAAA.'); process.exit(1); }

const combos = {}; // "NSITPED|NDEVNOT" -> { qtd, soma }
let totalGeral = 0, totalNoPeriodo = 0, foraDoPeriodo = 0;

scan(dbfPath, ['NDTEMIS', 'NSITPED', 'NDEVNOT', 'NTOTFAT', 'NNRNOTA'], (rec) => {
  if (rec.__deleted) return;
  totalGeral++;
  const data = parseData(rec.NDTEMIS);
  if (!data || data.chave < de.chave || data.chave > ate.chave) { foraDoPeriodo++; return; }
  totalNoPeriodo++;

  const sit = (rec.NSITPED === undefined ? '(campo não existe)' : '"' + rec.NSITPED + '"');
  const dev = (rec.NDEVNOT === undefined ? '(campo não existe)' : '"' + rec.NDEVNOT + '"');
  const chave = sit + ' / NDEVNOT=' + dev;
  if (!combos[chave]) combos[chave] = { qtd: 0, soma: 0 };
  combos[chave].qtd++;
  combos[chave].soma += num(rec.NTOTFAT);
});

console.log('=== Diagnóstico NSITPED + NDEVNOT — ' + deArg + ' até ' + ateArg + ' ===\n');
console.log('Notas no período: ' + totalNoPeriodo + ' (de ' + totalGeral + ' no arquivo todo)\n');

const chaves = Object.keys(combos).sort((a, b) => combos[b].soma - combos[a].soma);
console.log('NSITPED / NDEVNOT'.padEnd(35) + ' | qtd notas | soma NTOTFAT');
console.log('-'.repeat(70));
let somaTotalTudo = 0;
chaves.forEach((k) => {
  somaTotalTudo += combos[k].soma;
  console.log(k.padEnd(35) + ' | ' + String(combos[k].qtd).padStart(9) + ' | R$ ' + fmt(combos[k].soma));
});
console.log('-'.repeat(70));
console.log('SOMA DE TUDO (sem filtro nenhum): R$ ' + fmt(somaTotalTudo));

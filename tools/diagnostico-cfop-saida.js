'use strict';
// Quebra as notas "validas" (NSITPED="1" e NDEVNOT != "S") por CFOP (NNATOPE), dentro de um
// periodo - util para achar qual CFOP especifico esta causando uma diferenca residual no
// Total Faturado, quando a suspeita ja nao e mais NSITPED/NDEVNOT.
//
// Uso:
//   node tools/diagnostico-cfop-saida.js "<ftnota.dbf>" <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplo:
//   node tools/diagnostico-cfop-saida.js "G:\Zimmer\ftnota.dbf" 01/08/2026 31/08/2026

const { scan } = require('../src/dbf-reader');

const [, , dbfPath, deArg, ateArg] = process.argv;
if (!dbfPath || !deArg || !ateArg) {
  console.log('Uso: node tools/diagnostico-cfop-saida.js "<ftnota.dbf>" <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
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

const porCfop = {}; // NNATOPE -> { qtd, soma }
let totalNotasValidas = 0, totalSoma = 0;

scan(dbfPath, ['NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE', 'NTOTFAT'], (rec) => {
  if (rec.__deleted) return;
  const data = parseData(rec.NDTEMIS);
  if (!data || data.chave < de.chave || data.chave > ate.chave) return;
  if ((rec.NSITPED || '').trim() !== '1') return;
  if ((rec.NDEVNOT || '').trim() === 'S') return;

  totalNotasValidas++;
  const cfop = (rec.NNATOPE === undefined ? '(campo não existe)' : ('"' + rec.NNATOPE + '"'));
  if (!porCfop[cfop]) porCfop[cfop] = { qtd: 0, soma: 0 };
  porCfop[cfop].qtd++;
  const v = num(rec.NTOTFAT);
  porCfop[cfop].soma += v;
  totalSoma += v;
});

console.log('=== Diagnóstico CFOP (NNATOPE) — notas válidas (NSITPED="1", NDEVNOT!="S") — ' + deArg + ' até ' + ateArg + ' ===\n');
console.log('Total de notas válidas: ' + totalNotasValidas + '\n');

const chaves = Object.keys(porCfop).sort((a, b) => porCfop[b].soma - porCfop[a].soma);
console.log('NNATOPE (CFOP)'.padEnd(20) + ' | qtd notas | soma NTOTFAT');
console.log('-'.repeat(60));
chaves.forEach((k) => {
  console.log(k.padEnd(20) + ' | ' + String(porCfop[k].qtd).padStart(9) + ' | R$ ' + fmt(porCfop[k].soma));
});
console.log('-'.repeat(60));
console.log('TOTAL: R$ ' + fmt(totalSoma));

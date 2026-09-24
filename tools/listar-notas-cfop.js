'use strict';
// Lista NOTA A NOTA de um ou mais CFOPs, mostrando lado a lado o NTOTFAT (valor da nota) e a
// soma do Valor Final dos itens dela - util para caçar divergencias pontuais entre o total da
// nota e o total dos itens.
//
// Uso:
//   node tools/listar-notas-cfop.js "<cfop1,cfop2,...>" <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplos:
//   node tools/listar-notas-cfop.js "5.411,5.202,6.202" 01/08/2026 31/08/2026
//   node tools/listar-notas-cfop.js "5.922I" 01/08/2026 31/08/2026
//   node tools/listar-notas-cfop.js "todos" 01/08/2026 31/08/2026     (so as notas onde nota != itens)

const os = require('os');
const path = require('path');
const fs = require('fs');
const { scan } = require('../src/dbf-reader');
const { loadConfig } = require('../src/config-store');

const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
const candidatos = ['painel-fiscal', 'Painel Fiscal', 'Painel-Fiscal'];
let userDataDir = null;
for (const nome of candidatos) {
  const tentativa = path.join(roaming, nome);
  if (fs.existsSync(path.join(tentativa, 'config.json'))) { userDataDir = tentativa; break; }
}
if (!userDataDir) {
  console.log('Não encontrei o config.json. Abra o app e salve as Configurações primeiro.');
  process.exit(1);
}
const config = loadConfig(userDataDir);

function parseData(s) {
  const m = String(s || '').trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  return { txt: m[1] + '/' + m[2] + '/' + m[3], chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , cfopsArg, deArg, ateArg] = process.argv;
if (!cfopsArg || !deArg || !ateArg) {
  console.log('Uso: node tools/listar-notas-cfop.js "<cfop1,cfop2,...>" <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  console.log('Dica: use "todos" para listar só as notas onde o valor da nota difere da soma dos itens.');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);
if (!de || !ate) { console.log('Datas inválidas, use DD/MM/AAAA.'); process.exit(1); }

const modoTodos = cfopsArg.trim().toLowerCase() === 'todos';
const filtroCfops = modoTodos ? null : cfopsArg.split(',').map((c) => c.trim());

// --- 1) ftnota ---
console.log('Lendo ftnota.dbf ...');
const notas = new Map(); // numero -> {data, cfop, ntotfat, itens}
scan(config.paths.ftnota, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE', 'NTOTFAT'], (rec) => {
  if (rec.__deleted) return;
  const data = parseData(rec.NDTEMIS);
  if (!data || data.chave < de.chave || data.chave > ate.chave) return;
  if ((rec.NSITPED || '').trim() !== '1') return;
  if ((rec.NDEVNOT || '').trim() === 'S') return;

  const cfop = (rec.NNATOPE || '').trim();
  if (filtroCfops && !filtroCfops.includes(cfop)) return;

  notas.set((rec.NNRNOTA || '').trim(), { data: data.txt, cfop, ntotfat: num(rec.NTOTFAT), itens: 0 });
});

// --- 2) ftlnota: soma os itens de cada uma dessas notas ---
console.log('Lendo ftlnota.dbf ...\n');
scan(config.paths.ftlnota, ['LNRNOTA', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE'], (rec) => {
  if (rec.__deleted) return;
  const n = notas.get((rec.LNRNOTA || '').trim());
  if (!n) return;
  n.itens += num(rec.LVTOTAL) - num(rec.LVALDES) + num(rec.LVALACR) + num(rec.LVALFRE);
});

let linhas = Array.from(notas.entries()).map(([numero, n]) => Object.assign({ numero }, n, { dif: n.itens - n.ntotfat }));
if (modoTodos) linhas = linhas.filter((l) => Math.abs(l.dif) >= 0.01);
linhas.sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif) || b.ntotfat - a.ntotfat);

console.log('=== Notas — ' + (modoTodos ? 'TODAS com nota != itens' : 'CFOP ' + cfopsArg) + ' — ' + deArg + ' até ' + ateArg + ' ===\n');
console.log('nota     | data       | CFOP    |     NTOTFAT |  soma itens |   diferença');
console.log('-'.repeat(76));
let tN = 0, tI = 0;
linhas.forEach((l) => {
  tN += l.ntotfat; tI += l.itens;
  console.log(
    l.numero.padEnd(8) + ' | ' + l.data.padEnd(10) + ' | ' + l.cfop.padEnd(7) + ' | ' +
    fmt(l.ntotfat).padStart(11) + ' | ' + fmt(l.itens).padStart(11) + ' | ' + fmt(l.dif).padStart(11)
  );
});
console.log('-'.repeat(76));
console.log('TOTAL (' + linhas.length + ' notas)'.padEnd(24) + '| ' + fmt(tN).padStart(11) + ' | ' + fmt(tI).padStart(11) + ' | ' + fmt(tI - tN).padStart(11));

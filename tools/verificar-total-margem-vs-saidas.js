'use strict';
// Calcula, para o MESMO periodo, os dois totais que (segundo o responsavel do FAT) devem
// bater exatamente: o Total de Saidas (soma de NTOTFAT por nota) e o Total da Margem
// (soma do Valor Final de TODOS os itens/grupos, via ftlnota). Mostra os dois e a diferenca,
// pra usar como conferencia rapida sempre que ajustarmos os filtros de nota valida.
//
// Uso:
//   node tools/verificar-total-margem-vs-saidas.js <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplo:
//   node tools/verificar-total-margem-vs-saidas.js 01/08/2026 31/08/2026

const os = require('os');
const path = require('path');
const fs = require('fs');
const { scan } = require('../src/dbf-reader');
const { loadConfig } = require('../src/config-store');

const roaming = path.join(os.homedir(), 'AppData', 'Roaming');
const candidatos = ['painel-fiscal', 'Painel Fiscal', 'Painel-Fiscal', 'dt-board', 'Dt.Board', 'dt.board'];
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
  return { chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , deArg, ateArg] = process.argv;
if (!deArg || !ateArg) {
  console.log('Uso: node tools/verificar-total-margem-vs-saidas.js <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);
if (!de || !ate) { console.log('Datas inválidas, use DD/MM/AAAA.'); process.exit(1); }

console.log('=== Saídas x Margem — ' + deArg + ' até ' + ateArg + ' ===\n');
console.log('(usa a regra atual: NSITPED="1" e NDEVNOT != "S")\n');

// --- 1) le o ftnota, guarda numero->{data, valida} e ja soma o Total de Saidas ---
console.log('Lendo ftnota.dbf ...');
const notas = {};
let totalSaidas = 0, qtdNotasValidas = 0;
scan(config.paths.ftnota, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NTOTFAT'], (rec) => {
  if (rec.__deleted) return;
  const nota = (rec.NNRNOTA || '').trim();
  const data = parseData(rec.NDTEMIS);
  const situacaoValida = (rec.NSITPED || '').trim() === '1';
  const ehDevolucao = (rec.NDEVNOT || '').trim() === 'S';
  const valida = situacaoValida && !ehDevolucao;
  notas[nota] = { data, valida };

  if (valida && data && data.chave >= de.chave && data.chave <= ate.chave) {
    totalSaidas += num(rec.NTOTFAT);
    qtdNotasValidas++;
  }
});

// --- 2) le TODO o ftlnota e soma o Valor Final de cada item cuja nota e valida e esta no periodo ---
console.log('Lendo ftlnota.dbf (todos os itens) ...\n');
let totalMargem = 0, qtdItensValidos = 0;
scan(config.paths.ftlnota, ['LNRNOTA', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE'], (rec) => {
  if (rec.__deleted) return;
  const nota = (rec.LNRNOTA || '').trim();
  const infoNota = notas[nota];
  if (!infoNota || !infoNota.valida || !infoNota.data) return;
  if (infoNota.data.chave < de.chave || infoNota.data.chave > ate.chave) return;

  const vf = num(rec.LVTOTAL) - num(rec.LVALDES) + num(rec.LVALACR) + num(rec.LVALFRE);
  totalMargem += vf;
  qtdItensValidos++;
});

console.log('--- Total de SAÍDAS (soma de NTOTFAT por nota) ---');
console.log('Notas válidas no período: ' + qtdNotasValidas);
console.log('Total: R$ ' + fmt(totalSaidas) + '\n');

console.log('--- Total da MARGEM (soma do Valor Final de todos os itens/grupos) ---');
console.log('Itens válidos no período: ' + qtdItensValidos);
console.log('Total: R$ ' + fmt(totalMargem) + '\n');

const diff = totalMargem - totalSaidas;
console.log('--- Diferença ---');
console.log('Margem - Saídas = R$ ' + fmt(diff) + (diff >= 0 ? ' (Margem maior)' : ' (Saídas maior)'));
console.log((Math.abs(diff) < 0.01) ? '\n✅ BATEU EXATO — a regra atual já garante essa consistência.' : '\n⚠️  AINDA NÃO BATE — falta algum critério de exclusão de item/nota.');

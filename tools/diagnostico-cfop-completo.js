'use strict';
// Quebra, POR CFOP, os dois totais lado a lado:
//   - Soma de NTOTFAT (o que o widget de Saidas usa, no nivel da NOTA)
//   - Soma do Valor Final dos itens do ftlnota (o que a Margem usa, no nivel do ITEM)
//
// Isso revela CFOPs onde a nota esta zerada mas os itens tem valor (ou vice-versa) - que e
// exatamente o tipo de coisa que infla um total e nao o outro.
//
// Uso:
//   node tools/diagnostico-cfop-completo.js <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplo:
//   node tools/diagnostico-cfop-completo.js 01/08/2026 31/08/2026

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
  return { chave: Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]) };
}
function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , deArg, ateArg] = process.argv;
if (!deArg || !ateArg) {
  console.log('Uso: node tools/diagnostico-cfop-completo.js <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);
if (!de || !ate) { console.log('Datas inválidas, use DD/MM/AAAA.'); process.exit(1); }

console.log('=== CFOP: Saídas (NTOTFAT) x Margem (itens) — ' + deArg + ' até ' + ateArg + ' ===');
console.log('(notas válidas: NSITPED="1" e NDEVNOT != "S")\n');

// --- 1) ftnota: guarda numero -> {cfop, no periodo} e soma NTOTFAT por CFOP ---
console.log('Lendo ftnota.dbf ...');
const notas = {};
const porCfop = {}; // cfop -> { notas, somaNota, somaItens }
function bucket(cfop) {
  if (!porCfop[cfop]) porCfop[cfop] = { notas: 0, somaNota: 0, somaItens: 0 };
  return porCfop[cfop];
}

scan(config.paths.ftnota, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT', 'NNATOPE', 'NTOTFAT'], (rec) => {
  if (rec.__deleted) return;
  const nota = (rec.NNRNOTA || '').trim();
  const data = parseData(rec.NDTEMIS);
  const valida = (rec.NSITPED || '').trim() === '1' && (rec.NDEVNOT || '').trim() !== 'S';
  const noPeriodo = !!(data && data.chave >= de.chave && data.chave <= ate.chave);
  const cfop = (rec.NNATOPE || '(vazio)').trim() || '(vazio)';
  notas[nota] = { conta: valida && noPeriodo, cfop };

  if (valida && noPeriodo) {
    const b = bucket(cfop);
    b.notas++;
    b.somaNota += num(rec.NTOTFAT);
  }
});

// --- 2) ftlnota: soma o Valor Final dos itens, agrupando pelo CFOP da nota "pai" ---
console.log('Lendo ftlnota.dbf (todos os itens) ...\n');
scan(config.paths.ftlnota, ['LNRNOTA', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE'], (rec) => {
  if (rec.__deleted) return;
  const infoNota = notas[(rec.LNRNOTA || '').trim()];
  if (!infoNota || !infoNota.conta) return;
  bucket(infoNota.cfop).somaItens += num(rec.LVTOTAL) - num(rec.LVALDES) + num(rec.LVALACR) + num(rec.LVALFRE);
});

const chaves = Object.keys(porCfop).sort((a, b) => porCfop[b].somaItens - porCfop[a].somaItens);
console.log('CFOP'.padEnd(12) + '| notas |   Saídas (NTOTFAT) |    Margem (itens) |     diferença');
console.log('-'.repeat(82));
let totNota = 0, totItens = 0;
chaves.forEach((k) => {
  const b = porCfop[k];
  totNota += b.somaNota; totItens += b.somaItens;
  const marca = (b.somaNota === 0 && b.somaItens > 0) ? '  <<< nota ZERADA mas itens com valor!' : '';
  console.log(
    k.padEnd(12) + '| ' + String(b.notas).padStart(5) + ' | ' +
    fmt(b.somaNota).padStart(18) + ' | ' + fmt(b.somaItens).padStart(17) + ' | ' +
    fmt(b.somaItens - b.somaNota).padStart(13) + marca
  );
});
console.log('-'.repeat(82));
console.log('TOTAL'.padEnd(12) + '|       | ' + fmt(totNota).padStart(18) + ' | ' + fmt(totItens).padStart(17) + ' | ' + fmt(totItens - totNota).padStart(13));

// --- 3) simula o efeito de excluir os CFOPs suspeitos ---
const suspeitosItens = ['5.117', '5.927', '5.910', '5.905']; // nota zerada, mas itens com valor
const suspeitosDevCompra = ['5.202', '6.202', '5.411'];      // devolucao de COMPRA (nao e receita)

function soma(campo, lista) {
  return lista.reduce((acc, c) => acc + (porCfop[c] ? porCfop[c][campo] : 0), 0);
}

console.log('\n--- Simulação ---');
const itensSuspeitos = soma('somaItens', suspeitosItens);
const devCompraNota = soma('somaNota', suspeitosDevCompra);
const devCompraItens = soma('somaItens', suspeitosDevCompra);

console.log('Itens de CFOPs com nota zerada (' + suspeitosItens.join(', ') + '): R$ ' + fmt(itensSuspeitos));
console.log('Devolução de compra (' + suspeitosDevCompra.join(', ') + ') — nota: R$ ' + fmt(devCompraNota) + ' | itens: R$ ' + fmt(devCompraItens));
console.log('');
console.log('SAÍDAS  hoje: R$ ' + fmt(totNota) + '  →  excluindo devolução de compra: R$ ' + fmt(totNota - devCompraNota));
console.log('MARGEM  hoje: R$ ' + fmt(totItens) + '  →  excluindo os dois grupos:      R$ ' + fmt(totItens - itensSuspeitos - devCompraItens));
console.log('\n(o relatório do FAT de agosto/2026 dá R$ 4.796.458,26 nos dois)');

'use strict';
// Testa uma hipotese: sera que o "Total Faturado" das Saidas deveria vir de somar o Valor
// Final ITEM POR ITEM do ftlnota (igual a Margem faz), em vez de somar NTOTFAT por NOTA do
// ftnota (que e o que o widget de Saidas faz hoje)?
//
// Aplica a mesma regra do NSITPED/NDEVNOT (cruzando com ftnota pra pegar a data e a situacao
// de cada nota) e soma o Valor Final de TODOS os itens do ftlnota no periodo - sem separar
// por grupo/produto, so o total geral, pra comparar com o "Receita Bruta" do relatorio.
//
// Uso:
//   node tools/somar-valor-final-mes.js <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>
//
// Exemplo:
//   node tools/somar-valor-final-mes.js 01/08/2026 31/08/2026

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
  console.log('Uso: node tools/somar-valor-final-mes.js <data_inicio:DD/MM/AAAA> <data_fim:DD/MM/AAAA>');
  process.exit(1);
}
const de = parseData(deArg), ate = parseData(ateArg);
if (!de || !ate) { console.log('Datas inválidas, use DD/MM/AAAA.'); process.exit(1); }

console.log('=== Somando Valor Final item por item (ftlnota) — ' + deArg + ' até ' + ateArg + ' ===\n');

// --- 1) le o ftnota inteiro, guardando numero -> {data, situacaoValida, ehDevolucao} ---
console.log('Lendo ftnota.dbf ...');
const notas = {};
scan(config.paths.ftnota, ['NNRNOTA', 'NDTEMIS', 'NSITPED', 'NDEVNOT'], (rec) => {
  if (rec.__deleted) return;
  const nota = (rec.NNRNOTA || '').trim();
  const data = parseData(rec.NDTEMIS);
  const situacaoValida = (rec.NSITPED || '').trim() === '1';
  const ehDevolucao = (rec.NDEVNOT || '').trim() === 'S';
  notas[nota] = { data, valida: situacaoValida && !ehDevolucao };
});

// --- 2) soma o Valor Final de cada item do ftlnota, so das notas validas e dentro do periodo ---
console.log('Lendo ftlnota.dbf (todos os itens) ...\n');
let somaValorFinal = 0, somaValorFinalSemFiltro = 0, qtdItensValidos = 0, qtdItensTotal = 0, qtdItensSemNota = 0;

scan(config.paths.ftlnota, ['LNRNOTA', 'LVTOTAL', 'LVALDES', 'LVALACR', 'LVALFRE'], (rec) => {
  if (rec.__deleted) return;
  qtdItensTotal++;
  const nota = (rec.LNRNOTA || '').trim();
  const infoNota = notas[nota];
  const vf = num(rec.LVTOTAL) - num(rec.LVALDES) + num(rec.LVALACR) + num(rec.LVALFRE);

  if (!infoNota || !infoNota.data) { qtdItensSemNota++; return; }
  if (infoNota.data.chave < de.chave || infoNota.data.chave > ate.chave) return;

  somaValorFinalSemFiltro += vf;
  if (infoNota.valida) {
    somaValorFinal += vf;
    qtdItensValidos++;
  }
});

console.log('Itens no ftlnota (total do arquivo): ' + qtdItensTotal);
console.log('Itens cuja nota não foi encontrada no ftnota: ' + qtdItensSemNota);
console.log('Itens válidos (dentro do período, NSITPED="1" e NDEVNOT!="S"): ' + qtdItensValidos + '\n');
console.log('Soma do Valor Final (SEM aplicar NSITPED/NDEVNOT, só data): R$ ' + fmt(somaValorFinalSemFiltro));
console.log('Soma do Valor Final (COM NSITPED="1" e NDEVNOT!="S"):        R$ ' + fmt(somaValorFinal));
console.log('\nCompare com a "Receita Bruta" do relatório.');

'use strict';
// Ferramenta de VERIFICACAO INDEPENDENTE para Contas a Receber/Pagar - nao usa nenhuma
// funcao de calculo do app. Mostra os dados brutos e o agrupamento "até 30 dias" /
// "+ de 30 dias" calculado do zero, pra voce conferir se bate com o widget.
//
// Uso (so os totais por faixa):
//   node tools/verificar-aging.js <receber|pagar>
//
// Uso (mostra cada duplicata/nota individual, nao so o total):
//   node tools/verificar-aging.js <receber|pagar> detalhe
//
// Exemplo:
//   node tools/verificar-aging.js receber
//   node tools/verificar-aging.js pagar detalhe

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
  if (!s) return null;
  const m = String(s).trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const dia = Number(m[1]), mes = Number(m[2]), ano = Number(m[3]);
  if (dia < 1 || dia > 31 || mes < 1 || mes > 12) return null;
  return new Date(ano, mes - 1, dia);
}
function num(s) {
  const n = parseFloat(String(s || '0').trim());
  return isNaN(n) ? 0 : n;
}
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function fmtData(d) { return String(d.getDate()).padStart(2, '0') + '/' + String(d.getMonth() + 1).padStart(2, '0') + '/' + d.getFullYear(); }

const [, , tipoArg, modoArg] = process.argv;
if (!tipoArg || (tipoArg !== 'receber' && tipoArg !== 'pagar')) {
  console.log('Uso: node tools/verificar-aging.js <receber|pagar> [detalhe]');
  process.exit(1);
}
const detalhe = modoArg === 'detalhe';

const arquivo = tipoArg === 'receber' ? config.paths.ftcrec : config.paths.ftcpag;
const campoValor = tipoArg === 'receber' ? 'VALDUP' : 'VALCPG';
const campoPagamento = tipoArg === 'receber' ? 'DPGDUP' : 'DPGCPG';
const campoVencimento = tipoArg === 'receber' ? 'VCTDUP' : 'VCTCPG';

console.log('=== VERIFICAÇÃO INDEPENDENTE - ' + (tipoArg === 'receber' ? 'Contas a Receber' : 'Contas a Pagar') + ' ===');
console.log('(esta ferramenta NÃO usa nenhuma função de cálculo do app - só lê os campos crus)\n');

const hoje = new Date();
hoje.setHours(0, 0, 0, 0);
console.log('Data de hoje considerada: ' + fmtData(hoje) + '\n');

let ate30 = 0, mais30 = 0, jaLiquidadas = 0, semVencimentoValido = 0, total = 0;

scan(arquivo, [campoValor, campoPagamento, campoVencimento], (rec) => {
  if (rec.__deleted) return;
  total++;

  const pago = parseData(rec[campoPagamento]);
  if (pago) { jaLiquidadas++; return; } // ja liquidada, nao entra em nenhuma faixa

  const valor = num(rec[campoValor]);
  const venc = parseData(rec[campoVencimento]);

  if (!venc) {
    semVencimentoValido += valor;
    if (detalhe) console.log('  [SEM VENCIMENTO VÁLIDO] valor=' + fmt(valor) + ' vencimento="' + rec[campoVencimento] + '"');
    return;
  }

  const diffDias = Math.floor((hoje - venc) / (1000 * 60 * 60 * 24));
  const faixa = diffDias <= 30 ? 'ATE30' : 'MAIS30';
  if (faixa === 'ATE30') ate30 += valor; else mais30 += valor;

  if (detalhe) {
    console.log('  [' + faixa + '] vencimento=' + fmtData(venc) + ' (' + diffDias + ' dias atrás)  valor=' + fmt(valor));
  }
});

console.log('\n--- Resumo ---');
console.log('Total de registros no arquivo: ' + total);
console.log('Já liquidadas (não entram em nenhuma faixa): ' + jaLiquidadas);
console.log('Sem vencimento válido (contadas dentro de "+ de 30 dias"): R$ ' + fmt(semVencimentoValido));
console.log('');
console.log('Até 30 dias : R$ ' + fmt(ate30));
console.log('+ de 30 dias: R$ ' + fmt(mais30 + semVencimentoValido) + '  (inclui as sem vencimento válido)');
console.log('\nCompare esses dois valores com os cartões do widget no app.');

'use strict';
// Mostra TODOS os campos de uma nota especifica do ftnota.dbf, e todos os campos de cada
// item dela no ftlnota.dbf - util pra investigar por que o NTOTFAT da nota nao bate com a
// soma dos itens (pode revelar um campo que estamos deixando de somar).
//
// Ferramenta AUTOCONTIDA (não depende de nada do projeto).
//
// Uso:
//   node detalhar-nota.js <ftnota.dbf> <ftlnota.dbf> <numero_da_nota>
//
// Exemplo:
//   node detalhar-nota.js "G:\Zimmer\ftnota.dbf" "G:\Zimmer\ftlnota.dbf" 338212

const fs = require('fs');

function scanDbf(caminho, onRecord, filtro) {
  const fd = fs.openSync(caminho, 'r');
  const cabecalho = Buffer.alloc(32);
  fs.readSync(fd, cabecalho, 0, 32, 0);
  const numRecords = cabecalho.readUInt32LE(4);
  const headerSize = cabecalho.readUInt16LE(8);
  const recordSize = cabecalho.readUInt16LE(10);
  const descArea = Buffer.alloc(headerSize - 32);
  fs.readSync(fd, descArea, 0, descArea.length, 32);
  const campos = [];
  let off = 0;
  while (descArea[off] !== 0x0D) {
    const name = descArea.toString('ascii', off, off + 11).replace(/\0.*$/, '').trim();
    const length = descArea[off + 16];
    campos.push({ name, length });
    off += 32;
  }
  const TAMANHO_BLOCO = 2000;
  const bufBloco = Buffer.alloc(recordSize * TAMANHO_BLOCO);
  let lidos = 0;
  while (lidos < numRecords) {
    const nesteBloco = Math.min(TAMANHO_BLOCO, numRecords - lidos);
    const bytesLidos = fs.readSync(fd, bufBloco, 0, recordSize * nesteBloco, headerSize + lidos * recordSize);
    if (bytesLidos <= 0) break;
    for (let i = 0; i < nesteBloco; i++) {
      const recOff = i * recordSize;
      if (bufBloco[recOff] === 0x2A) continue;
      // le so o campo de filtro primeiro (rapido), pra decidir se vale a pena montar o resto
      if (filtro) {
        let fOff2 = recOff + 1, valorFiltro = null;
        for (const c of campos) {
          if (c.name === filtro.campo) valorFiltro = bufBloco.toString('latin1', fOff2, fOff2 + c.length).trim();
          fOff2 += c.length;
        }
        if (valorFiltro !== filtro.valor) continue;
      }
      const rec = {};
      let fOff = recOff + 1;
      for (const c of campos) { rec[c.name] = bufBloco.toString('latin1', fOff, fOff + c.length).trim(); fOff += c.length; }
      onRecord(rec);
    }
    lidos += nesteBloco;
  }
  fs.closeSync(fd);
}

function num(s) { const n = parseFloat(String(s || '0').trim()); return isNaN(n) ? 0 : n; }
function fmt(n) { return n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

const [, , ftnotaPath, ftlnotaPath, notaArg] = process.argv;
if (!ftnotaPath || !ftlnotaPath || !notaArg) {
  console.log('Uso: node detalhar-nota.js <ftnota.dbf> <ftlnota.dbf> <numero_da_nota>');
  process.exit(1);
}
const notaAlvo = notaArg.trim(); // usa exatamente o que foi digitado, sem inventar zeros a esquerda

console.log('=== Cabeçalho da nota (ftnota.dbf) — nota ' + notaArg + ' ===\n');
let achouNota = false;
scanDbf(ftnotaPath, (rec) => {
  achouNota = true;
  Object.entries(rec).forEach(([campo, valor]) => {
    if (valor !== '') console.log('  ' + campo.padEnd(12) + '= ' + valor);
  });
}, { campo: 'NNRNOTA', valor: notaAlvo });

if (!achouNota) {
  console.log('  (nota não encontrada com NNRNOTA="' + notaAlvo + '" exatamente)');
  console.log('  Procurando notas parecidas (que contenham "' + notaAlvo + '") pra ver o formato real do campo...\n');
  let exemplos = 0;
  scanDbf(ftnotaPath, (rec) => {
    if (exemplos >= 5) return;
    if ((rec.NNRNOTA || '').includes(notaAlvo)) {
      console.log('  encontrado: NNRNOTA="' + rec.NNRNOTA + '" (comprimento ' + rec.NNRNOTA.length + ')');
      exemplos++;
    }
  });
  if (exemplos === 0) console.log('  Nenhuma parecida encontrada também - confere se o caminho do ftnota.dbf está certo.');
  process.exit(0);
}

console.log('\n=== Itens da nota (ftlnota.dbf) ===\n');
let somaVF = 0, somaLVTOTAL = 0;
let n = 0;
scanDbf(ftlnotaPath, (rec) => {
  n++;
  console.log('--- item ' + n + ' ---');
  Object.entries(rec).forEach(([campo, valor]) => {
    if (valor !== '') console.log('  ' + campo.padEnd(12) + '= ' + valor);
  });
  const vf = num(rec.LVTOTAL) - num(rec.LVALDES) + num(rec.LVALACR) + num(rec.LVALFRE);
  somaVF += vf;
  somaLVTOTAL += num(rec.LVTOTAL);
  console.log('  (Valor Final deste item = ' + fmt(vf) + ')\n');
}, { campo: 'LNRNOTA', valor: notaAlvo });

console.log('=== Resumo ===');
console.log('Itens encontrados: ' + n);
console.log('Soma de LVTOTAL (sem descontos/acrescimos/frete): R$ ' + fmt(somaLVTOTAL));
console.log('Soma do Valor Final (LVTOTAL-LVALDES+LVALACR+LVALFRE): R$ ' + fmt(somaVF));

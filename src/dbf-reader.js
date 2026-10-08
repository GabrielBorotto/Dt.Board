'use strict';
const fs = require('fs');

// Le o cabecalho de um .dbf: versao, numero de registros, tamanho do cabecalho/registro
// e a lista de campos (nome, tipo, tamanho, decimais, offset dentro do registro).
function readHeader(fd) {
  const headerBuf = Buffer.alloc(32);
  fs.readSync(fd, headerBuf, 0, 32, 0);

  const version = headerBuf[0];
  const numRecords = headerBuf.readUInt32LE(4);
  const headerSize = headerBuf.readUInt16LE(8);
  const recordSize = headerBuf.readUInt16LE(10);

  const fields = [];
  let descOffset = 32;
  let pos = 1; // offset dentro do registro; byte 0 e a flag de exclusao (deletado)

  //nunca passa do tamanho do cabeçalho, nem do fim do arquivo.
  while (descOffset + 32 <= headerSize) {
    const fbuf = Buffer.alloc(32);
    const lidos = fs.readSync(fd, fbuf, 0, 32, descOffset);
    if (lidos < 32 || fbuf[0] === 0x0d) break;

    let nameEnd = fbuf.indexOf(0);
    if (nameEnd === -1 || nameEnd > 11) nameEnd = 11;
    const name = fbuf.toString('latin1', 0, nameEnd).trim();
    const type = String.fromCharCode(fbuf[11]);
    const length = fbuf[16];
    const dec = fbuf[17];

    fields.push({ name, type, length, dec, offset: pos });
    pos += length;
    descOffset += 32;
  }

  const fieldsByName = {};
  for (const f of fields) fieldsByName[f.name] = f;

  return { version, numRecords, headerSize, recordSize, fields, fieldsByName };
}

// Le apenas o cabecalho/estrutura de um .dbf (usado para inspecao/diagnostico).
function readMeta(path) {
  const fd = fs.openSync(path, 'r');
  try {
    return readHeader(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// Decodifica os campos desejados de um Buffer de um unico registro (ja recortado).
function decodeRecord(meta, recordBuf, wantedFields) {
  const out = { __deleted: recordBuf[0] === 0x2a };
  for (const name of wantedFields) {
    const field = meta.fieldsByName[name];
    if (!field) { out[name] = undefined; continue; }
    out[name] = recordBuf.toString('latin1', field.offset, field.offset + field.length).trim();
  }
  return out;
}

// Varre um .dbf em lotes (nao carrega o arquivo inteiro na memoria).
// onRecord(recordObj, recordIndex) e chamado para cada registro nao removido logicamente
// (registros com flag de exclusao continuam sendo entregues, com __deleted=true, para quem
// quiser filtrar).
// options.startRecord permite retomar a partir de um indice (leitura incremental).
// Retorna o meta (para o chamador saber quantos registros existem no total).
function scan(path, wantedFields, onRecord, options) {
  options = options || {};
  const fd = fs.openSync(path, 'r');
  try {
    const meta = readHeader(fd);
    const BATCH_RECORDS = 4000;
    const buf = Buffer.alloc(meta.recordSize * BATCH_RECORDS);

    let recordIndex = options.startRecord || 0;
    let filePos = meta.headerSize + recordIndex * meta.recordSize;

    while (recordIndex < meta.numRecords) {
      const remaining = meta.numRecords - recordIndex;
      const toRead = Math.min(BATCH_RECORDS, remaining);
      const bytesToRead = toRead * meta.recordSize;
      const bytesRead = fs.readSync(fd, buf, 0, bytesToRead, filePos);
      if (bytesRead <= 0) break;

      const fullRecords = Math.floor(bytesRead / meta.recordSize);
      for (let i = 0; i < fullRecords; i++) {
        const recBuf = buf.subarray(i * meta.recordSize, (i + 1) * meta.recordSize);
        const rec = decodeRecord(meta, recBuf, wantedFields);
        onRecord(rec, recordIndex + i);
      }

      recordIndex += fullRecords;
      filePos += bytesRead;
      if (fullRecords === 0) break;
    }

    return meta;
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { readHeader, readMeta, decodeRecord, scan };

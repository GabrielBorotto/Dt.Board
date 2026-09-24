'use strict';

// Converte "DD/MM/AAAA" em Date local, retornando null para vazio ou datas invalidas/placeholder
// (o sistema FAT usa coisas como "00/00/0000" ou "99/99/9999" para "sem data").
function parseBrDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (!m) return null;
  const day = Number(m[1]), month = Number(m[2]), year = Number(m[3]);
  if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > 2200) return null;
  const d = new Date(year, month - 1, day);
  // valida que a data "bateu" (evita 31/02 virando 03/03 silenciosamente)
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

function isoDate(d) {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

// Converte texto numerico do dbf (ex: "1361.80", "", "0.00") em number. Vazio -> 0.
function parseNum(raw) {
  if (raw === undefined || raw === null) return 0;
  const s = String(raw).trim();
  if (s === '') return 0;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

module.exports = { parseBrDate, isoDate, parseNum };

'use strict';
// =====================================================================================
// Atualização do Dt.Board distribuído em ZIP (sem instalador)
// -------------------------------------------------------------------------------------
// 1. Ao abrir (e a cada 6 horas) pergunta ao GitHub qual é a última versão PUBLICADA.
//    Rascunhos (Draft) e pré-lançamentos (Pre-release) não aparecem pros clientes.
// 2. Se for mais nova que a atual, avisa a tela (o aviso pulsante do cabeçalho).
// 3. Ao clicar no aviso: baixa o zip, extrai numa pasta temporária e confere se está inteiro.
// 4. Dispara um "ajudante": o Dt.Board.exe da versão NOVA rodando como Node (sem janela).
//    Ele espera o app atual fechar, copia os arquivos novos por cima da pasta do app (tentando
//    de novo se o antivírus estiver segurando algum arquivo) e abre o app de novo.
//    (Não usa cmd/prompt: no Windows 11 isso abria janelas do Terminal e travava.)
// 5. Qualquer falha: o app continua na versão atual e o download abre no navegador.
// Só usa o que já vem no Windows 10/11 (tar.exe) e o próprio app. Nada é instalado.
//
// TESTE antes de liberar pros clientes: publique a versão no GitHub marcada como
// "Pre-release" e abra uma cópia antiga do app com a variável DTB_ATUALIZACAO_TESTE=1.
// Só essa cópia enxerga o pré-lançamento.
// =====================================================================================
const { app, net, shell } = require('electron');
const path = require('path');
// original-fs: o fs "de verdade". O fs normal do Electron trata arquivos .asar como pastas,
// e o zip da versão nova tem um resources\app.asar dentro.
const ofs = require('original-fs');
const { spawn } = require('child_process');

const REPO = 'GabrielBorotto/Dt.Board';
const INTERVALO_VERIFICACAO_MS = 6 * 60 * 60 * 1000; // a cada 6 horas
const ESPERA_PRIMEIRA_VERIFICACAO_MS = 10 * 1000;     // 10 s depois de abrir

let getJanela = () => null;
let registrarErro = () => {};
let disponivel = null;   // { versao, zip: { nome, url, tamanho } }
let emAndamento = false;

// ---------- Funções puras ----------

// '1.1.6' / 'v1.1.6' -> [1, 1, 6]
function partesVersao(v) {
  return String(v || '').trim().replace(/^v/i, '').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
}

// 1 se a > b, -1 se a < b, 0 se iguais
function compararVersoes(a, b) {
  const pa = partesVersao(a), pb = partesVersao(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] || 0, y = pb[i] || 0;
    if (x !== y) return x > y ? 1 : -1;
  }
  return 0;
}

// Primeiro arquivo .zip anexado à versão no GitHub
function escolherZip(release) {
  const assets = (release && Array.isArray(release.assets)) ? release.assets : [];
  const zip = assets.find((a) => a && typeof a.name === 'string' && a.name.toLowerCase().endsWith('.zip') && a.browser_download_url);
  return zip ? { nome: zip.name, url: zip.browser_download_url, tamanho: Number(zip.size) || 0 } : null;
}

// Pasta onde está o Dt.Board.exe dentro do que foi extraído (na raiz ou numa única subpasta)
function localizarRaiz(pasta, nomeExe) {
  if (ofs.existsSync(path.join(pasta, nomeExe))) return pasta;
  const candidatas = ofs.readdirSync(pasta, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(pasta, d.name))
    .filter((p) => ofs.existsSync(path.join(p, nomeExe)));
  return candidatas.length === 1 ? candidatas[0] : null;
}

// ---------- Apoio ----------

function enviar(canal, valor) {
  const janela = getJanela();
  if (janela && !janela.isDestroyed()) janela.webContents.send(canal, valor);
}

// %LOCALAPPDATA%\Dt.Board-atualizacao: fica no PC (não vai pro OneDrive nem pro perfil móvel)
function pastaTrabalho() {
  return path.join(process.env.LOCALAPPDATA || app.getPath('temp'), 'Dt.Board-atualizacao');
}

function modoTeste() {
  return process.env.DTB_ATUALIZACAO_TESTE === '1';
}

function pastaGravavel(pasta) {
  const teste = path.join(pasta, '.dtboard-teste-gravacao');
  try {
    ofs.writeFileSync(teste, 'ok');
    ofs.unlinkSync(teste);
    return true;
  } catch (e) {
    return false;
  }
}

// ---------- GitHub ----------

async function buscarUltimaRelease() {
  const url = 'https://api.github.com/repos/' + REPO + (modoTeste() ? '/releases?per_page=10' : '/releases/latest');
  const res = await net.fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (res.status === 404) return null; // nenhuma versão publicada ainda
  if (!res.ok) throw new Error('GitHub respondeu ' + res.status + ' ao verificar atualização');
  const dados = await res.json();
  if (!modoTeste()) return dados;
  // modo de teste: aceita também pré-lançamentos; a lista vem da mais nova pra mais antiga
  return (Array.isArray(dados) ? dados : []).find((r) => r && !r.draft) || null;
}

async function verificar() {
  if (!app.isPackaged || emAndamento) return;
  try {
    const release = await buscarUltimaRelease();
    if (!release || !release.tag_name) return;
    const versao = String(release.tag_name).replace(/^v/i, '');
    if (compararVersoes(versao, app.getVersion()) <= 0) return; // já está na mais nova
    const zip = escolherZip(release);
    if (!zip) {
      registrarErro(new Error('Versão ' + versao + ' publicada sem arquivo .zip; atualização ignorada'));
      return;
    }
    disponivel = { versao, zip };
    enviar('update-available', versao);
  } catch (err) {
    registrarErro(err); // sem internet, GitHub fora do ar etc.: só registra, não incomoda
  }
}

// ---------- Download e extração ----------

async function baixar(url, destino, tamanhoEsperado, aoProgresso) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error('Download da atualização falhou (HTTP ' + res.status + ')');
  const total = Number(res.headers.get('content-length')) || tamanhoEsperado || 0;
  const arquivo = await ofs.promises.open(destino, 'w');
  let recebido = 0;
  let ultimoPct = -1;
  try {
    const leitor = res.body.getReader();
    for (;;) {
      const { done, value } = await leitor.read();
      if (done) break;
      await arquivo.write(value);
      recebido += value.length;
      if (total) {
        const pct = Math.min(99, Math.floor(recebido / total * 100));
        if (pct !== ultimoPct) { ultimoPct = pct; aoProgresso(pct); }
      }
    }
  } finally {
    await arquivo.close();
  }
  if (tamanhoEsperado && recebido !== tamanhoEsperado) {
    throw new Error('Download incompleto: ' + recebido + ' de ' + tamanhoEsperado + ' bytes');
  }
}

function extrair(arquivoZip, destino) {
  return new Promise((resolve, reject) => {
    const tar = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe');
    if (!ofs.existsSync(tar)) { reject(new Error('tar.exe não encontrado (precisa do Windows 10 ou mais novo)')); return; }
    const processo = spawn(tar, ['-xf', arquivoZip, '-C', destino], { windowsHide: true });
    let saidaErro = '';
    processo.stderr.on('data', (d) => { saidaErro += d; });
    processo.on('error', reject);
    processo.on('close', (codigo) => {
      if (codigo === 0) resolve();
      else reject(new Error('Falha ao extrair a atualização (tar, código ' + codigo + '): ' + saidaErro.trim()));
    });
  });
}

// ---------- Troca dos arquivos (depois que o app fecha) ----------

// Roda dentro do Dt.Board.exe NOVO (da pasta extraída) com ELECTRON_RUN_AS_NODE=1, ou seja,
// como Node puro: sem janela, sem cmd e sem prompt. Os caminhos chegam por variáveis de ambiente.
const SCRIPT_APLICAR = `'use strict';
process.noAsar = true; // app.asar é copiado como arquivo comum
let fs;
try { fs = require('original-fs'); } catch (e) { fs = require('fs'); }
const path = require('path');
const { spawn } = require('child_process');
const E = process.env;
const pid = Number(E.DTB_PID);
const origem = E.DTB_ORIGEM;
const destino = E.DTB_DESTINO;

function registrar(msg) {
  try { fs.appendFileSync(E.DTB_LOG, '[' + new Date().toISOString() + '] ' + msg + '\\n'); } catch (e) { /* sem log */ }
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
function vivo(p) {
  try { process.kill(p, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}
function listar(pasta, base, lista) {
  for (const d of fs.readdirSync(pasta, { withFileTypes: true })) {
    const p = path.join(pasta, d.name);
    if (d.isDirectory()) listar(p, base, lista); else lista.push(path.relative(base, p));
  }
  return lista;
}
async function copiar(rel) {
  const de = path.join(origem, rel);
  const para = path.join(destino, rel);
  fs.mkdirSync(path.dirname(para), { recursive: true });
  for (let tentativa = 1; ; tentativa++) {
    try { fs.copyFileSync(de, para); return true; } catch (e) {
      if (tentativa >= 30) { registrar('falhou ao copiar ' + rel + ': ' + e.message); return false; }
      await dormir(1000); // arquivo preso (antivírus ou processo terminando): tenta de novo
    }
  }
}
function reabrir() {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE; // senão o app abriria como Node e fecharia na hora
  for (const k of Object.keys(env)) if (k.indexOf('DTB_') === 0 && k !== 'DTB_ATUALIZACAO_TESTE') delete env[k];
  spawn(E.DTB_EXE, [], { detached: true, stdio: 'ignore', cwd: destino, env }).unref();
}

(async () => {
  registrar('versao ' + E.DTB_VERSAO + ': esperando o app fechar');
  for (let i = 0; i < 120 && vivo(pid); i++) await dormir(1000);
  if (vivo(pid)) { registrar('o app nao fechou em 2 minutos; atualizacao cancelada'); return; }
  await dormir(1500); // os outros processos do Electron terminam logo depois do principal
  const arquivos = listar(origem, origem, []);
  let falhas = 0;
  for (const rel of arquivos) if (!(await copiar(rel))) falhas++;
  registrar('copiados ' + (arquivos.length - falhas) + ' de ' + arquivos.length + ' arquivos');
  reabrir();
  registrar('app reaberto');
})().catch((e) => { registrar('erro: ' + (e && e.stack ? e.stack : e)); try { reabrir(); } catch (x) { /* nada */ } });
`;

function iniciarCopiaAoFechar(raiz, versao) {
  return new Promise((resolve, reject) => {
    const script = path.join(pastaTrabalho(), 'aplicar-atualizacao.js');
    ofs.writeFileSync(script, SCRIPT_APLICAR, 'utf8');
    // o ajudante é o Dt.Board.exe da versão nova (o da pasta do app vai ser substituído)
    const ajudante = path.join(raiz, path.basename(process.execPath));
    const processo = spawn(ajudante, [script], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      cwd: raiz,
      env: Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1',
        DTB_PID: String(process.pid),
        DTB_ORIGEM: raiz,
        DTB_DESTINO: path.dirname(process.execPath),
        DTB_EXE: process.execPath,
        DTB_VERSAO: versao,
        DTB_LOG: path.join(app.getPath('userData'), 'atualizacao.log'),
      }),
    });
    processo.on('error', reject);
    processo.on('spawn', () => { processo.unref(); resolve(); });
  });
}

// Chamado quando a pessoa clica no aviso
async function aplicar() {
  if (!disponivel || emAndamento) return false;
  emAndamento = true;
  const { versao, zip } = disponivel;
  const pastaApp = path.dirname(process.execPath);
  const nomeExe = path.basename(process.execPath);
  try {
    if (!app.isPackaged) throw new Error('A atualização só funciona no app empacotado (não no npm start)');
    if (!pastaGravavel(pastaApp)) throw new Error('Sem permissão de gravação na pasta do app: ' + pastaApp);

    const trabalho = pastaTrabalho();
    ofs.rmSync(trabalho, { recursive: true, force: true });
    const pastaNova = path.join(trabalho, 'novo');
    ofs.mkdirSync(pastaNova, { recursive: true });
    const arquivoZip = path.join(trabalho, 'atualizacao.zip');

    enviar('update-progress', 0);
    await baixar(zip.url, arquivoZip, zip.tamanho, (pct) => enviar('update-progress', pct));
    enviar('update-progress', 100);

    await extrair(arquivoZip, pastaNova);
    const raiz = localizarRaiz(pastaNova, nomeExe);
    if (!raiz) throw new Error('O zip da versão ' + versao + ' não tem o ' + nomeExe);
    if (!ofs.existsSync(path.join(raiz, 'resources', 'app.asar'))) {
      throw new Error('O zip da versão ' + versao + ' está incompleto (sem resources\\app.asar)');
    }

    await iniciarCopiaAoFechar(raiz, versao);
    enviar('update-downloaded', versao);
    setTimeout(() => app.quit(), 1500); // dá tempo de a pessoa ler o aviso
    return true;
  } catch (err) {
    emAndamento = false;
    registrarErro(err);
    enviar('update-error', versao);
    try { shell.openExternal(zip.url); } catch (e) { /* sem navegador: o erro já foi registrado */ }
    return false;
  }
}

// Chamado uma vez quando o app abre
function iniciar({ janela, log }) {
  getJanela = janela;
  registrarErro = log;
  if (!app.isPackaged) return; // no npm start não verifica nada

  // limpa sobras de uma atualização anterior (a pasta temporária)
  setTimeout(() => {
    if (emAndamento) return;
    try { ofs.rmSync(pastaTrabalho(), { recursive: true, force: true }); } catch (e) { /* tenta na próxima */ }
  }, 60 * 1000);

  setTimeout(verificar, ESPERA_PRIMEIRA_VERIFICACAO_MS);
  setInterval(verificar, INTERVALO_VERIFICACAO_MS);
}

module.exports = { iniciar, aplicar, verificar, compararVersoes, escolherZip, localizarRaiz, SCRIPT_APLICAR };

# Dt.Board

Aplicativo Windows instalável que lê direto dos arquivos `.dbf` do sistema FAT
(`ftnota.dbf`, `ftentr.dbf`, `ftcrec.dbf`, `ftcpag.dbf`) e mostra:

- **Saídas**: gráfico de `NTOTFAT` (com abas de período) + ICMS/PIS/COFINS/total do período
- **Entradas**: gráfico de `NTOTNOT` (com abas de período) + ICMS/PIS/COFINS/total do período
- **Contas a receber**: total liquidado hoje / este mês / este ano (`VALDUP`, só quando `DPGDUP` está preenchida)
- **Contas a pagar**: total liquidado hoje / este mês / este ano (`VALCPG`, só quando `DPGCPG` está preenchida)
- **Margem por Grupos**: Tabela dos grupos / Quantidade vendida / Total faturado / Custo da venda / Margem em valor e porcentagem; Filtrado com `NSITPED=1`, `NDEVNOT` e `NNATOPE`.

## Como funciona por baixo dos panos

- O app **não usa nenhuma biblioteca de terceiros para ler o `.dbf`** — o leitor
  (`src/dbf-reader.js`) interpreta o formato binário diretamente, o que dá controle total
  sobre desempenho em arquivos grandes (testado com arquivos de centenas de MB).
- A leitura roda em uma **worker thread** separada (`src/scan-worker.js`), então a tela
  nunca trava enquanto os arquivos são varridos.
- Os resultados ficam em **cache local** (na pasta de dados do usuário do Windows) — o app
  abre instantâneo mostrando o último dado conhecido, e atualiza sozinho em segundo plano.
- **Atualização automática a cada 5 minutos** por padrão (configurável na tela de
  Configurações). Isso é necessário porque cancelamentos e liquidações **alteram registros
  já existentes** no `.dbf` (não são só novas linhas no final do arquivo), então o app
  precisa reler o arquivo inteiro periodicamente para capturar essas mudanças — não dá pra
  fazer leitura incremental "só do que mudou". Tem um botão "Atualizar agora" no
  cabeçalho pra forçar a releitura na hora.

## Estrutura do projeto

```
main.js              processo principal do Electron (janela, agendamento, IPC)
preload.js            ponte seguro entre o processo principal e a tela
src/
  dbf-reader.js        leitor binario de .dbf (cabecalho + varredura em lotes)
  dbf-utils.js          parse de datas BR e numeros
  aggregator.js          agrega os registros em totais por dia
  scan-worker.js          roda em background, varre os 4 arquivos
  config-store.js          le/grava config.json (caminhos dos arquivos, intervalo)
renderer/
  index.html / style.css / renderer.js     a tela em si
  vendor/chart.umd.js                       Chart.js empacotado localmente (funciona offline)
test/
  logic.test.js          testes automatizados do leitor/agregador
```

## Rodando em modo desenvolvimento

Pré-requisito: [Node.js](https://nodejs.org) instalado na máquina de desenvolvimento.

```
npm install
npm test        # roda os testes automatizados (gera .dbf sinteticos e confere os calculos)
npm start        # abre o app
```

Na primeira vez que abrir, clique no ícone de engrenagem (⚙) no canto superior direito e
preencha os caminhos dos 4 arquivos (pode ser caminho de rede, tipo
`\\SERVIDOR\pasta\ftnota.dbf`, ou uma letra de unidade mapeada, tipo `G:\Zimmer\ftnota.dbf`).

## Gerando o instalador Windows (.exe)

```
npm run dist
```

Isso usa o [electron-builder](https://www.electron.build/) pra gerar um instalador NSIS
dentro da pasta `dist/`. Rode esse comando numa máquina Windows (ou com as ferramentas de
cross-build do electron-builder configuradas) para gerar o `.exe` final que você vai
distribuir para os clientes.

Pra usar um ícone próprio: crie um arquivo `build/icon.ico` (256x256) e adicione de volta
`"icon": "build/icon.ico"` dentro de `build.win` no `package.json`.

## Campos usados de cada arquivo

| Arquivo | Campos | Regra |
|---|---|---|
| `ftnota.dbf` | `NDTEMIS`, `NTOTFAT`, `NVALICM`+`NVALICM1`, `NPISNOT`, `NCOFNOT`, `NDTCANC` | exclui se `NSITPED, NDEVNOT e NNATOPE` forem diferente do esperado |
| `ftentr.dbf` | `NDTENTR` (data de entrada, não de emissão!), `NTOTNOT`, `NVALICM`, `NVALPIS`, `NVALFIN` | sem filtro de cancelamento (não existe nesse arquivo) |
| `ftcomp.dbf` | `NDTEMIS`, `NTOTNOT`, `NVALICM`+`NVALICM1`, `NPISNOT`, `NCOFNOT`, `NDTCANC` | devoluções de venda (CFOP 1.202/1.411/1.949) — somado junto com o `ftentr.dbf` para compor os totais de Entrada, conforme confirmado contra o relatório "Resumo Impostos Entrada x Saída" do próprio FAT |
| `ftcrec.dbf` | `VALDUP`, `DPGDUP`, `VCTDUP` | só entra se `DPGDUP` estiver vazio (não liquidado); agrupado em até 30 / +30 dias de atraso do vencimento |
| `ftcpag.dbf` | `VALCPG`, `DPGCPG`, `VCTCPG` | mesma regra do `ftcrec.dbf` |

## Próximos passos possíveis (me avise se quiser)

- Adicionar layout ajustável (mover/redimensionar widgets), como fizemos no protótipo web
- Detalhar "Dia específico" por hora (o `ftnota.dbf` tem o campo `NHOSAID` com o horário de
  saída — hoje o app mostra só o total do dia, não a distribuição por hora)
- Empacotar um ícone e nome de marca personalizados
- Suporte a múltiplos clientes/empresas (perfis de configuração separados)

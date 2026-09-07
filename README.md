# servBoard

Dashboard gráfica para um servidor doméstico com monitor. Aparece em tela cheia
(Chromium em modo kiosk) em horários que você configura e mostra **slots** de
conteúdo independentes. Fora das janelas de exibição, **nada fica rodando** —
quem acorda tudo nos horários é o systemd.

Esta é a **base**. Cada slot ganha sua lógica própria depois; já vêm dois de
exemplo (`clock`, `notes`).

![dashboard](docs/screenshot.png)

## Como funciona

```
config/servboard.json ──► servboard refresh ──► data/cache/<slot>.json
                                                        │
horário / comando ──► servboard serve (Fastify) ──► lê o cache ──► navegador kiosk
```

- **refresh**: roda o `refresh()` de cada slot (buscar/gerar dados) e grava um
  cache em disco. É um job pontual — executa e sai.
- **serve**: servidor web que serve a página e o cache. Só sobe durante a janela
  de exibição.
- **kiosk**: Chromium em `--kiosk` apontando para o servidor local.

Duas formas de exibir:

| | Comando |
|---|---|
| **Por horário** | `servboard install` cria os timers do systemd a partir da config |
| **Por comando (teste)** | `servboard show` (tudo junto) ou `serve` / `kiosk` separados |

## Uso local (desenvolvimento)

```bash
npm install
node bin/servboard.js doctor      # valida ambiente e config
node bin/servboard.js refresh      # gera data/cache/*.json
node bin/servboard.js serve        # http://127.0.0.1:4870
node bin/servboard.js show         # refresh + serve + navegador kiosk (Ctrl-C encerra)
npm test                           # testes unitários (node --test)
```

Sem `config/servboard.json`, usa `config/servboard.example.json`.

## Configuração — `config/servboard.json`

```jsonc
{
  "timezone": "America/Sao_Paulo",
  "server":  { "host": "127.0.0.1", "port": 4870 },
  "layout":  { "columns": 3, "gap": 16 },
  "display": {
    "start": "07:00",          // liga a dashboard
    "stop":  "23:00",          // desliga (apaga a tela)
    "days":  "Mon..Sun",       // expressão de dias do systemd: "Mon..Fri", "Mon,Wed,Fri"
    "browser": "auto",         // "auto" ou caminho de um Chromium
    "powerManagement": true,   // usa xset para ligar/desligar o monitor (X11)
    "xDisplay": ":0"           // display X do monitor do servidor (usado nas units)
  },
  "refresh": {
    "onCalendar": "*:0/15",    // OnCalendar do systemd: a cada 15 min
    "runBeforeDisplay": true   // faz um refresh ao ligar a dashboard
  },
  "slotPaths": [               // pastas extras de slots (além de ./slots)
    "../servboard-slots/slots" // relativo à raiz do projeto; aceita ~ e caminho absoluto
  ],
  "slots": [
    { "id": "clock", "enabled": true },
    { "id": "notes", "enabled": true, "title": "Avisos", "span": 2,
      "settings": { "text": "Olá", "items": ["a", "b"] } }
  ]
}
```

- `slots[].span` — quantas colunas o card ocupa no grid.
- `slots[].settings` — objeto livre, entregue ao `refresh(ctx)` do slot em `ctx.settings`.
- Reordenar a lista `slots` reordena o grid.
- `slotPaths` — ver [Slots num repo separado](#slots-num-repo-separado).

## Criar um slot

```bash
servboard new-slot energia                 # cria em ./slots (ou 1ª entrada de slotPaths)
servboard new-slot energia --path ../servboard-slots/slots
```

```
<pasta-de-slots>/<id>/
  slot.json    { "id": "<id>", "title": "...", "span": 1, "refreshInterval": "5m" }
  index.js     export async function refresh(ctx) { return { ... } }   // vira o cache
  view.js      export function render(el, data, ctx) { ... }           // opcional
  view.css     estilos do slot                                        // opcional
```

`ctx` no `refresh`: `{ settings, config: { timezone }, now, logger }`.
O valor retornado é serializado em `data/cache/<id>.json` (`{ data, updatedAt, error }`).
Se o slot não tiver `view.js`, a UI mostra o JSON cru — útil enquanto se desenvolve.

`render(el, data, ctx)` recebe o container e o `data` do cache; pode devolver uma
função de limpeza (ex.: `clearInterval`). Veja `slots/clock/`.

Um slot só aparece na dashboard quando está **numa pasta de slots** E **listado em
`config.slots` com `enabled: true`**.

## Slots num repo separado

A pasta `slots/` do repositório tem só os exemplos (`clock`, `notes`). Os seus
slots ficam **fora daqui**, num repositório próprio (privado, se quiser), com a
mesma estrutura:

```
servboard-slots/            <- seu repo
  slots/
    energia/  { slot.json, index.js, view.js, view.css }
    agenda/   { ... }
```

Aponte a base para ele de uma destas formas (podem ser várias pastas):

```jsonc
// config/servboard.json
"slotPaths": ["../servboard-slots/slots"]
```
```bash
# ou por ambiente (separado por ":"), útil em scripts/systemd
SERVBOARD_SLOTS_PATH=/caminho/servboard-slots/slots servboard serve
```

Prioridade quando o mesmo `id` existe em mais de uma pasta:
`SERVBOARD_SLOTS_PATH` > `slotPaths` (na ordem) > `slots/` do repo. Assim um slot
seu pode **substituir** um exemplo. `servboard list` mostra de qual pasta veio cada slot.

No servidor: clone os dois repos lado a lado, `git pull` em cada um
independente. Atualizar a base nunca conflita com os seus slots.

## Deploy (exibição agendada)

Como o usuário que fica logado no monitor, na pasta do projeto:

```bash
./deploy/install.sh          # npm ci + doctor + gera/ativa os timers do systemd --user
systemctl --user start servboard-web.service   # testar agora
```

`servboard install` gera as units do systemd `--user` a partir de
`config/servboard.json` (re-rode após mudar horários). Requer uma sessão gráfica
X11 no monitor e `loginctl enable-linger <usuário>`.

Detalhes, tabela de units e um `.xinitrc` mínimo para máquina sem desktop:
[`deploy/README.md`](deploy/README.md).

## CLI

```
servboard doctor                 valida ambiente e config
servboard refresh [--slot id]    roda o refresh dos slots e sai
servboard serve                  só o servidor web (foreground)
servboard kiosk                  só o navegador em kiosk (foreground)
servboard show                   refresh + serve + kiosk (foreground)
servboard list                   pastas de slots + estado do cache
servboard new-slot <id>          cria o esqueleto de um slot [--path <pasta>]
servboard install [--dry-run]    units do systemd --user a partir da config
servboard uninstall [--dry-run]  remove as units
servboard within-window          exit 0 se agora está na janela de exibição
```

`SERVBOARD_LOG_LEVEL=debug|info|warn|error` controla o log.

## Requisitos

- Node.js >= 20
- Chromium (`sudo apt install chromium`) para os modos `kiosk` / `show`
- sessão gráfica no monitor do servidor (X11 recomendado para o controle de energia)

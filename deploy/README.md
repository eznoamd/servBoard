# Deploy — exibição agendada via systemd

O servBoard roda **sob demanda**: nada fica no ar 24h. Timers do systemd `--user`
sobem o servidor + o navegador na janela de exibição e derrubam tudo no fim.

Pré-requisitos no alvo:

- Node.js >= 20
- um navegador Chromium (`chromium`, `google-chrome`, `brave`…)
- uma **sessão gráfica X11** ativa no monitor (o `xset` de energia não existe no Wayland)
- `loginctl enable-linger <usuário>` para os timers dispararem sem login interativo

## Instalar

Como o usuário que fica logado no monitor (não root), na pasta do projeto:

```bash
./deploy/install.sh
```

Ele roda `npm ci --omit=dev`, cria `config/servboard.json` a partir do exemplo,
valida com `servboard doctor` e chama `servboard install`.

`servboard install` **gera** as units a partir de `config/servboard.json` e as
escreve em `~/.config/systemd/user/`:

| Unit | Papel |
|---|---|
| `servboard-refresh.service` / `.timer` | `servboard refresh` no `refresh.onCalendar` (job pontual) |
| `servboard-web.service` | servidor web; `ExecStartPre` faz um refresh se `refresh.runBeforeDisplay` |
| `servboard-kiosk.service` | navegador em kiosk; `BindsTo` o web (cai junto); `Environment=DISPLAY` de `display.xDisplay` |
| `servboard-display.timer` | inicia `servboard-web.service` no `display.start` |
| `servboard-display-stop.service` / `.timer` | para o web (e o kiosk) no `display.stop` e apaga a tela |

Depois de mudar `config/servboard.json`, rode `servboard install` de novo.

Ver o que seria gerado, sem escrever nada: `servboard install --dry-run`.

## Sessão gráfica no monitor

O `servboard-kiosk.service` só consegue abrir o navegador se já existir um X
rodando no monitor com `DISPLAY` = `display.xDisplay` (padrão `:0`).

Se o alvo é um desktop com login normal, não precisa fazer nada — a sessão já
existe. Se é uma máquina sem ambiente gráfico, você monta um X mínimo do jeito
que preferir (autologin no console + `startx`, um display manager, `cage`…).
Um `~/.xinitrc` mínimo que funciona bem com o servBoard:

```sh
#!/bin/sh
xset s off; xset s noblank; xset -dpms      # a energia da tela é do servBoard
unclutter -idle 1 -root &                    # esconde o cursor
systemctl --user import-environment DISPLAY XAUTHORITY
# reabre a dashboard se a máquina reiniciou no meio da janela:
servboard within-window --quiet && systemctl --user start servboard-web.service
exec openbox-session                         # ou outro WM leve
```

## Operação

```bash
systemctl --user list-timers | grep servboard        # próximos disparos
systemctl --user start servboard-web.service          # ligar agora (teste)
systemctl --user stop  servboard-web.service          # desligar agora
journalctl --user -u servboard-web.service -f         # logs do servidor
journalctl --user -u servboard-kiosk.service -f       # logs do navegador
servboard within-window                               # exit 0 se agora ∈ janela
```

## Desinstalar

```bash
./deploy/uninstall.sh          # remove as units; mantém código e config
```

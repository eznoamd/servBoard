# Deploy — dashboard sempre ativa via systemd

O servBoard fica **sempre no ar**: dois serviços do systemd `--user` mantêm o
servidor web e o navegador kiosk rodando (`Restart=always`). O servidor tem um
loop interno que reatualiza os slots a cada `refresh.everyMinutes`. Não há mais
horários de ligar/desligar.

Pré-requisitos no alvo:

- Node.js >= 20
- um navegador Chromium (`chromium`, `google-chrome`, `brave`…)
- uma **sessão gráfica X11** ativa no monitor (o `xset` que mantém a tela ligada
  não existe no Wayland)
- `loginctl enable-linger <usuário>` para os serviços subirem sem login interativo

## Instalar

Como o usuário que fica logado no monitor (não root), na pasta do projeto:

```bash
./deploy/install.sh
```

Ele roda `npm ci --omit=dev`, cria `config/servboard.json` a partir do exemplo,
valida com `servboard doctor` e chama `servboard install`.

`servboard install` **gera** as units e as escreve em `~/.config/systemd/user/`:

| Unit | Papel |
|---|---|
| `servboard-web.service` | servidor web + loop de refresh dos slots; `Restart=always`; `WantedBy=default.target` |
| `servboard-kiosk.service` | navegador em kiosk; `BindsTo` o web (cai junto); `Environment=DISPLAY` de `display.xDisplay`; `Restart=always` |

Só o `servboard-web.service` é habilitado; ele puxa o kiosk via
`Wants=servboard-kiosk.service`.

Depois de mudar `config/servboard.json`, rode `servboard install` de novo.
Ver o que seria gerado, sem escrever nada: `servboard install --dry-run`.

Se a máquina já tinha o modelo antigo (units `servboard-refresh.timer`,
`servboard-display*.timer`), o `install`/`uninstall` as remove sozinho.

### Slots num repo separado

As units rodam com `WorkingDirectory` = raiz do projeto, então um `slotPaths`
relativo como `"../servboard-slots/slots"` resolve para um repo clonado **ao lado**
do servBoard. Para um caminho fixo, use absoluto ou `SERVBOARD_SLOTS_PATH` (o
`servboard install` propaga o env atual para as units). `git pull` nos dois
repos; o loop de refresh roda os slots dos dois.

## Sessão gráfica no monitor

O `servboard-kiosk.service` só consegue abrir o navegador se já existir um X
rodando no monitor com `DISPLAY` = `display.xDisplay` (padrão `:0`). Enquanto o X
não estiver pronto, o serviço reinicia a cada 3 s (`Restart=always`) até conseguir.

Se o alvo é um desktop com login normal, não precisa fazer nada — a sessão já
existe. Se é uma máquina sem ambiente gráfico, você monta um X mínimo do jeito
que preferir (autologin no console + `startx`, um display manager, `cage`…).
Um `~/.xinitrc` mínimo que funciona bem com o servBoard:

```sh
#!/bin/sh
xset s off; xset s noblank; xset -dpms      # a tela fica sempre ligada
unclutter -idle 1 -root &                    # esconde o cursor
systemctl --user import-environment DISPLAY XAUTHORITY
systemctl --user start servboard-web.service
exec openbox-session                         # ou outro WM leve
```

## Operação

```bash
systemctl --user status servboard-web.service servboard-kiosk.service
systemctl --user restart servboard-web.service        # recarregar após mudar config
systemctl --user stop  servboard-web.service          # derruba web + kiosk
journalctl --user -u servboard-web.service -f         # logs do servidor / refresh
journalctl --user -u servboard-kiosk.service -f       # logs do navegador
```

## Desinstalar

```bash
./deploy/uninstall.sh          # remove as units; mantém código e config
```

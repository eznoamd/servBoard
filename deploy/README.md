# Deploy — referência

**Passo a passo completo (servidor do zero):** [`server-setup.md`](server-setup.md).

Este arquivo é só a referência dos artefatos.

## Scripts

| Script | Roda como | Faz |
|---|---|---|
| `provision-base.sh` | usuário admin + sudo | sistema, segurança, ufw, Node, estrutura de pastas, usuário `kiosk` |
| `provision-kiosk.sh` | `sudo` | X + openbox, autologin, servBoard, timers |
| `update.sh` | `sudo` | `git pull` + `npm ci` + `servboard install` + restart |
| `install.sh` | usuário que roda a dashboard | só a parte do servBoard (npm + doctor + `servboard install`), quando o resto já existe |
| `uninstall.sh` | idem | remove as units |

## Arquivos de sessão do usuário `kiosk` (`deploy/kiosk/`)

- `bash_profile` → `~kiosk/.bash_profile` — inicia `startx` no tty1
- `xinitrc` → `~kiosk/.xinitrc` — desliga screensaver, esconde cursor, entrega
  `DISPLAY` ao systemd, abre a dashboard se estiver na janela, roda `openbox`

## Units geradas por `servboard install`

Não são arquivos fixos — `src/install.js` gera a partir de `config/servboard.json`,
em `~/.config/systemd/user/`.

| Unit | Papel |
|---|---|
| `servboard-refresh.service` / `.timer` | `servboard refresh` no `refresh.onCalendar` (job pontual) |
| `servboard-web.service` | servidor web; `ExecStartPre` faz um refresh se `refresh.runBeforeDisplay` |
| `servboard-kiosk.service` | navegador em kiosk; `BindsTo` o web — cai junto; `Environment=DISPLAY` de `display.xDisplay` |
| `servboard-display.timer` | inicia `servboard-web.service` no `display.start` |
| `servboard-display-stop.service` / `.timer` | para o web (e o kiosk) no `display.stop`, apaga a tela |

Entre as janelas: só X + openbox ociosos (dezenas de MB) e os timers. O Chromium
— que é o gasto real — só roda na janela de exibição, e a tela fica em DPMS-off.

## Operação

```bash
sudo -u kiosk systemctl --user list-timers | grep servboard
sudo -u kiosk systemctl --user start servboard-web.service     # ligar agora
sudo -u kiosk systemctl --user stop  servboard-web.service     # desligar agora
sudo -u kiosk journalctl --user -u servboard-web.service -f    # logs
sudo -u kiosk servboard install --dry-run                      # ver units sem instalar
```

Depois de mudar `config/servboard.json`, rode `servboard install` de novo.

## Requisitos

- Node.js >= 20 (o `provision-base.sh` instala o 22 LTS)
- `chromium`, `xserver-xorg`, `xinit`, `openbox`, `x11-xserver-utils`, `unclutter`
  (o `provision-kiosk.sh` instala)
- sessão gráfica X11 no monitor do servidor (Wayland não suporta o `xset` de energia)
- `loginctl enable-linger kiosk` (os scripts fazem)

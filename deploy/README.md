# Deploy no servidor Debian

As units do systemd **não são arquivos fixos** neste diretório — elas são geradas
a partir de `config/servboard.json` por `servboard install`, para os horários
ficarem sempre em sincronia com a config.

## Passos

```bash
# no servidor, como o usuário da sessão gráfica (não root)
git clone <repo> ~/servBoard && cd ~/servBoard
./deploy/install.sh
```

O `install.sh`:

1. `npm ci --omit=dev`
2. cria `config/servboard.json` (copie do exemplo) se não existir
3. `servboard doctor` — valida ambiente e horários
4. `servboard install` — escreve as units em `~/.config/systemd/user/`,
   roda `loginctl enable-linger` e habilita os timers

## Units geradas

| Unit | Papel |
|---|---|
| `servboard-refresh.service` / `.timer` | roda `servboard refresh` no `refresh.onCalendar` (job pontual) |
| `servboard-web.service` | servidor web; `ExecStartPre` faz um refresh se `runBeforeDisplay` |
| `servboard-kiosk.service` | navegador em kiosk; `BindsTo` o web — cai junto |
| `servboard-display.timer` | inicia `servboard-web.service` no horário `display.start` |
| `servboard-display-stop.service` / `.timer` | para o web (e o kiosk) no `display.stop` |

Entre as janelas, **nada roda** além dos próprios timers do systemd.

## Ver o que seria gerado, sem instalar

```bash
node bin/servboard.js install --dry-run
```

## Operação

```bash
systemctl --user list-timers | grep servboard      # próximos disparos
systemctl --user start servboard-web.service        # ligar agora (teste)
systemctl --user stop  servboard-web.service        # desligar agora
journalctl --user -u servboard-web.service -f       # logs do servidor
journalctl --user -u servboard-refresh.service -f   # logs do refresh
```

Depois de mudar `config/servboard.json`, rode `servboard install` de novo para
regenerar as units com os novos horários.

## Requisitos no servidor

- Node.js >= 20
- um navegador Chromium: `sudo apt install chromium`
- sessão gráfica ativa no monitor (X11 recomendado para o `xset` de energia)
- `loginctl enable-linger $USER` (o install faz isso) para os timers rodarem sem login

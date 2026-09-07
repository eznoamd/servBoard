# Montar o servidor do zero (Debian mínimo → dashboard rodando)

Guia completo para um Debian recém-instalado, sem interface gráfica, que vai
rodar o servBoard no monitor **e** outros serviços depois.

Você roda os comandos no servidor (via SSH ou teclado/monitor); este guia é a
sequência. Dois scripts fazem o trabalho pesado:

| Script | O quê | Como rodar |
|---|---|---|
| `deploy/provision-base.sh` | sistema, segurança, firewall, Node, estrutura de pastas, usuário `kiosk` | como seu usuário admin, com sudo |
| `deploy/provision-kiosk.sh` | X + openbox, autologin no monitor, servBoard, timers | `sudo` |

Ambos são **idempotentes** — pode rodar de novo sem medo.

---

## 0. Antes de começar

Na instalação do Debian, o mínimo:

- **não** marque "Ambiente de trabalho / GNOME"; marque só "utilitários padrão do sistema" e "servidor SSH";
- crie seu usuário normal (ex.: `enzo`) — será o **administrador** (tem sudo);
- anote o IP do servidor (`ip -4 addr`).

Da sua máquina, teste o SSH e copie sua chave (evita ficar digitando senha):

```bash
ssh-copy-id enzo@192.168.x.x
ssh enzo@192.168.x.x
```

---

## 1. Base do sistema

No servidor:

```bash
git clone <URL-do-repo> ~/servBoard-src      # ou baixe só os scripts
cd ~/servBoard-src
sudo -v && ./deploy/provision-base.sh
```

O que ele faz:

- `apt full-upgrade` + utilitários (`git`, `curl`, `htop`, `tmux`, `jq`, `rsync`…)
- **fuso horário** `America/Sao_Paulo` e **NTP** (chrony)
- **unattended-upgrades** — patches de segurança automáticos
- **ufw** — nega tudo que entra, libera só SSH e mDNS (a dashboard é localhost, não precisa de porta)
- **Node.js 22 LTS** (repo NodeSource)
- **estrutura de diretórios** (veja abaixo)
- cria o usuário **`kiosk`** (sem sudo, sem senha, só autologin no monitor)

Variáveis opcionais: `TIMEZONE=... NODE_MAJOR=22 KIOSK_USER=kiosk ./deploy/provision-base.sh`

### Depois do provision-base (uma vez)

```bash
sudo hostnamectl set-hostname servboard          # opcional; acessível como servboard.local
# fechar login SSH por senha (já que sua chave funciona):
sudo sed -i 's/^#\?PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart ssh
```

---

## 2. Estrutura do servidor (para crescer sem virar bagunça)

```
/opt/<serviço>/     código das aplicações (repositórios git)   → /opt/servboard
/srv/<serviço>/     dados persistentes de cada serviço           → /srv/paperless, /srv/...
/srv/backups/       backups locais
/etc/<serviço>/     config de sistema, quando fizer sentido
```

Convenções para os **próximos serviços**:

- **1 serviço = 1 pasta em `/opt` + 1 pasta de dados em `/srv`**. Nada de dado dentro de `/opt` (o código é descartável, os dados não).
- Serviço headless (sem tela): rode como **contêiner** (Docker/Podman) com um
  `compose.yml` dentro de `/opt/<serviço>/`, ou como um **usuário de sistema
  dedicado** + unit systemd. Um usuário por serviço = isolamento barato.
- O `kiosk` é o único que precisa de sessão gráfica — os outros não encostam no X.
- Acesso externo (ver os serviços de outro dispositivo): quando precisar, ponha
  um **Caddy** ou **Tailscale** na frente. Enquanto for só a dashboard no
  monitor, não precisa de nada disso.
- **Backups**: comece simples — um cron diário com `rsync`/`restic` de `/srv` e
  dos `config/` para `/srv/backups` (e, idealmente, para fora do servidor).

Instalar Docker quando chegar a hora:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # relogar depois
```

---

## 3. servBoard (a dashboard)

```bash
sudo git clone <URL-do-repo> /opt/servboard
sudo /opt/servboard/deploy/provision-kiosk.sh
```

O que ele faz:

- instala `xserver-xorg`, `xinit`, `openbox`, `unclutter`, `chromium`, fontes
- **autologin** do usuário `kiosk` no `tty1` → `startx` → `openbox`
- instala `~kiosk/.bash_profile` e `~kiosk/.xinitrc` (de `deploy/kiosk/`)
- `npm ci --omit=dev` em `/opt/servboard` como `kiosk`
- cria `config/servboard.json` (do exemplo) se não existir
- linka `/usr/local/bin/servboard`
- `loginctl enable-linger kiosk` (timers rodam sem ninguém logado via SSH)
- `servboard doctor` e `servboard install` (gera e ativa os timers)

### Configurar

```bash
sudo -u kiosk vim /opt/servboard/config/servboard.json
sudo -u kiosk servboard install      # SEMPRE rode isto após mudar horários
```

Campos que importam (detalhe completo no `README.md` da raiz):

```jsonc
"display": { "start": "07:00", "stop": "23:00", "days": "Mon..Sun", "xDisplay": ":0" },
"refresh": { "onCalendar": "*:0/15" }
```

- `display.start/stop` — quando a tela liga e desliga.
- `refresh.onCalendar` — de quanto em quanto tempo os dados dos slots atualizam
  (roda mesmo com a tela apagada, se quiser dados fresquinhos ao ligar).
- `xDisplay` — quase sempre `:0`.

### Ligar

```bash
sudo reboot
```

No boot: `tty1` faz autologin → `startx` → `openbox`. Se o horário atual estiver
dentro da janela, a dashboard abre sozinha. Fora da janela, a tela fica apagada
até o `display.start`.

---

## 4. As duas formas de exibir

**Por horário** (automático): os timers `servboard-display.timer` e
`servboard-display-stop.timer`, gerados pelo `servboard install` a partir da config.

**Por comando** (teste), como o usuário `kiosk`:

```bash
sudo -u kiosk systemctl --user start servboard-web.service   # liga a dashboard agora
sudo -u kiosk systemctl --user stop  servboard-web.service   # desliga agora
```

Ou, sem systemd, direto no console gráfico do servidor:

```bash
sudo -u kiosk servboard show      # refresh + servidor + navegador; Ctrl-C encerra
```

---

## 5. Operação e diagnóstico

```bash
# próximos disparos dos timers
sudo -u kiosk systemctl --user list-timers | grep servboard

# logs
sudo -u kiosk journalctl --user -u servboard-web.service -f
sudo -u kiosk journalctl --user -u servboard-kiosk.service -f
sudo -u kiosk journalctl --user -u servboard-refresh.service --since today

# estado dos slots / cache
sudo -u kiosk servboard list

# ver as units que seriam geradas, sem instalar
sudo -u kiosk servboard install --dry-run
```

### Atualizar o servBoard

```bash
sudo /opt/servboard/deploy/update.sh
```

### Problemas comuns

| Sintoma | Causa provável | Ação |
|---|---|---|
| tela preta, sem X | `startx` falhou | `sudo -u kiosk journalctl --user -b` e `cat ~kiosk/.local/share/xorg/Xorg.0.log` |
| "Only console users are allowed to run the X server" | autologin não pegou | confira `/etc/systemd/system/getty@tty1.service.d/autologin.conf`, `systemctl daemon-reload`, reboot |
| dashboard não abre no horário | timer não ativo / fora da janela | `systemctl --user list-timers`; `servboard within-window` |
| navegador abre mas página em branco | servidor não subiu | `journalctl --user -u servboard-web.service` |
| tela não apaga no `display.stop` | `powerManagement` off ou Wayland | use X11; `"powerManagement": true`; teste `DISPLAY=:0 xset dpms force off` |
| Chromium reclama de "não foi encerrado corretamente" | queda anterior | inofensivo; o perfil isolado fica em `/opt/servboard/data/chromium-profile` |

---

## Resumo da ordem

```bash
# 1. base
./deploy/provision-base.sh
sudo hostnamectl set-hostname servboard
# 2. dashboard
sudo git clone <repo> /opt/servboard
sudo /opt/servboard/deploy/provision-kiosk.sh
sudo -u kiosk vim /opt/servboard/config/servboard.json
sudo -u kiosk servboard install
sudo reboot
```

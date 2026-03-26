# Claude Mission Control

Terminal multiplexer para [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Ve todo lo que Claude Code hace en tiempo real: agentes, thinking, tools, y archivos — cada uno en su propio panel.

```
┌──────── Claude Mission Control ─── ● 2 agents ── 8 tools ── 3 files ── hooks ─┐
│                              │                          │
│  MAIN terminal               │  THINKING               │
│  Full Claude Code session    │  reasoning...            │
│                              ├──────────────────────────┤
├──────────────┬───────────────┤  TOOLS                   │
│              │               │  ✓ Read src/index.ts     │
│  AGENT-1     │  AGENT-2      │  ✓ Edit src/parser.ts    │
│  Explore     │  coder11111   ├──────────────────────────┤
│  ✓ done     │  ⟳ working   │  FILES                   │
│              │               │  M src/index.ts          │
│              │               │  A src/utils/helper.ts   │
└──────────────┴───────────────┴──────────────────────────┘
```

## Que es

Claude Code corre en una sola terminal. Cuando usa agentes, piensa, llama tools, o edita archivos — todo sale mezclado en un solo stream. Tienes que hacer scroll y reconstruir mentalmente que paso.

**Mission Control** envuelve Claude Code y separa el output en paneles:

- **MAIN** — Terminal completa de Claude Code (emulacion VT100 real)
- **AGENT-1 / AGENT-2** — Sub-agentes, aparecen solos cuando se crean
- **THINKING** — Stream de razonamiento extendido
- **TOOLS** — Tool calls con status (pending / success / error)
- **FILES** — Cambios de archivos en tiempo real

Todo automatico. Zero config. Entras, usas Claude Code normalmente, y ves todo.

## Instalar

```bash
git clone https://github.com/axeliparrea/claude-code-mission-control.git
cd claude-mission-control
npm install
```

Si `node-pty` falla al compilar:

```bash
# macOS
xcode-select --install && npm rebuild node-pty

# Linux (Debian/Ubuntu)
sudo apt install build-essential python3 && npm rebuild node-pty

# Arch Linux
sudo pacman -S base-devel python && npm rebuild node-pty

# Windows
npm install -g windows-build-tools && npm rebuild node-pty
```

## Usar

```bash
# Desde cualquier proyecto
cd ~/mi-proyecto
node --import tsx /ruta/a/claude-mission-control/src/index.ts

# O desde el repo directamente
cd claude-mission-control
npm start

# Con npm link (para usar `cmc` globalmente)
cd claude-mission-control
npm link
cd ~/mi-proyecto
cmc
```

Claude Code se lanza dentro de Mission Control. Escribes normal — tu input va directo a Claude Code.

## Controles

Hay dos modos:

### Modo passthrough (default)

Todo lo que tecleas va directo a Claude Code. Es como si estuvieras en la terminal normal.

| Tecla | Accion |
|---|---|
| Esc | Entrar a modo panel |
| Ctrl+C x2 | Salir de Mission Control (doble rapido) |
| Ctrl+C x1 | Se envia a Claude Code (comportamiento normal) |

### Modo panel (Esc para activar)

Navegas entre paneles para hacer scroll y ver contenido.

| Tecla | Accion |
|---|---|
| Tab | Siguiente panel |
| Up / Down | Scroll del panel enfocado |
| q | Salir de Mission Control |
| Esc | Volver a modo passthrough |

## Sandbox (probar sin Claude Code real)

```bash
npm run sandbox
```

Lanza Mission Control con un mock de Claude Code. Dentro puedes escribir:

- `test thinking` — simula un bloque de pensamiento
- `test tools` — simula tool calls
- `test agents` — simula spawn de agentes
- `test files` — simula cambios de archivos
- `test hooks` — simula eventos via hook IPC
- `test all` — todo junto
- `test stress` — 200 lineas rapidas para stress test

## Tests

```bash
npm test                  # 227 tests
npm run test:integration  # solo tests de integracion (MCP pipeline)
npm run test:watch        # watch mode
npm run typecheck         # verificar tipos
```

## Requisitos

- **Node.js 22+**
- **Claude Code** instalado (`claude` en PATH)
- Terminal con 256 colores (cualquier terminal moderna)
- Minimo 100 columnas x 25 filas (terminales chicas usan layout compacto)

## Como funciona (resumen)

```
Tu terminal
|
+-- node-pty crea un pseudo-terminal y lanza `claude`
|
+-- El output raw del PTY alimenta:
|   +-- @xterm/headless (emulacion VT100 completa para MAIN)
|   +-- Parser (clasifica lineas -> THINKING / AGENT / TOOLS / FILES)
|
+-- Hook system (IPC via unix sockets):
|   +-- MC inyecta hooks en Claude Code settings al iniciar
|   +-- Claude Code ejecuta hook-forward.js en cada tool call
|   +-- hook-forward.js envia JSON al IPC socket de MC
|   +-- MC recibe datos estructurados (tool name, agent type, etc.)
|
+-- chokidar vigila el directorio de trabajo -> FILES panel
|
+-- Screen buffer renderiza todos los paneles con diff-based updates (~30fps)
    Solo las celdas que cambiaron se redibujan cada frame.
```

Claude Code **no sabe** que esta envuelto. Ve una terminal normal.

## Licencia

MIT

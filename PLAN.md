# Claude Mission Control — Plan Arquitectónico v2

## 1. Resumen ejecutivo

TUI cross-platform que envuelve Claude Code para dar visibilidad total sobre su ejecución en tiempo real: terminal principal, sub-agentes, thinking, tool calls MCP, y cambios de archivos — todo en una sola vista, zero-config.

### Cambios clave vs plan v1

| Aspecto | Plan v1 | Plan v2 | Por qué |
|---------|---------|---------|---------|
| Lenguaje | JavaScript | **TypeScript strict** | Type safety, mejor DX, discriminated unions para eventos |
| Framework TUI | blessed (directo) | **blessed + capa de abstracción** | Protege contra lock-in, permite swap futuro |
| Fuente de datos | Solo PTY parsing (regex) | **Híbrido: Hooks + PTY + FileSystem** | Hooks dan datos estructurados confiables; PTY solo para contenido visual |
| Plataformas | Solo macOS | **Windows + macOS + Linux** | Requisito de diseño desde el inicio |
| Parser | Regex monolítico | **Pipeline de Matchers con estado y confianza** | Extensible, robusto, degrada gracefully |
| IPC (hooks→TUI) | No existía | **Unix socket / Named pipe** | Cross-platform, sub-ms latencia, Node `net` nativo |
| Render | setTimeout 16ms | **Render coalescing adaptativo** | Frame rate ajustable según carga real |

---

## 2. Stack tecnológico

| Componente | Tecnología | Versión | Razón |
|---|---|---|---|
| Lenguaje | TypeScript | 5.7+ | Strict mode, discriminated unions, exhaustive checks |
| Runtime | Node.js | 22+ | ESM nativo, performance improvements |
| TUI | blessed | 0.1.81 | ScrollableBox con scroll independiente, differential render, ANSI passthrough |
| PTY | node-pty | 1.0+ | Unix PTY (macOS/Linux) + ConPTY (Windows) en una API |
| File watcher | chokidar | 4.0+ | FSEvents (mac), inotify (linux), ReadDirectoryChangesW (win) |
| ANSI strip | strip-ansi | 7.1+ | Limpia ANSI para matching, preserva original para display |
| Dev runner | tsx | 4.0+ | Ejecuta TypeScript directo sin compilar |
| Bundler | tsup | 8.0+ | Bundle a single file para distribución |
| Tests | vitest | 2.0+ | Fast, TypeScript nativo, compatible con Node |

### Dependencias dev adicionales

```
@types/blessed    — tipos para blessed
@types/node       — tipos de Node.js
typescript        — compilador
```

---

## 3. Arquitectura

### 3.1 Vista general

```
┌─────────────────────────────────────────────────────────────────┐
│                      CLAUDE MISSION CONTROL                      │
│                                                                   │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────────────┐    │
│  │ PTY Manager │  │ Hook Server  │  │ File Watcher         │    │
│  │ (node-pty)  │  │ (net.Server) │  │ (chokidar)           │    │
│  │             │  │              │  │                      │    │
│  │ Spawn claude│  │ Recibe JSON  │  │ Detecta cambios      │    │
│  │ via PTY     │  │ de hooks     │  │ en disco             │    │
│  └──────┬──────┘  └──────┬───────┘  └──────────┬───────────┘    │
│         │                │                      │                │
│         ▼                ▼                      ▼                │
│  ┌──────────────────────────────────────────────────────────┐    │
│  │                       EVENT BUS                           │    │
│  │              (typed, ordered, buffered)                    │    │
│  └───────────────────────┬──────────────────────────────────┘    │
│                          │                                       │
│         ┌────────────────┼────────────────┐                     │
│         ▼                ▼                ▼                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐            │
│  │ Parser      │  │ Correlation │  │ Panel Router │            │
│  │ Pipeline    │  │ Engine      │  │              │            │
│  │ (matchers)  │  │ (hook+pty)  │  │ main/think/  │            │
│  │             │  │             │  │ agent/mcp/   │            │
│  │             │  │             │  │ files        │            │
│  └─────────────┘  └─────────────┘  └──────┬──────┘            │
│                                            │                    │
│                                            ▼                    │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    RENDER SCHEDULER                        │   │
│  │           (coalesced, adaptive frame rate)                 │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                   │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │                    BLESSED SCREEN                          │   │
│  │   ┌─────────┬──────────┬──────────┬────────┬────────┐    │   │
│  │   │  MAIN   │ AGENT-1  │ AGENT-2  │ THINK  │  MCP   │    │   │
│  │   │  Panel  │  Panel   │  Panel   │ Panel  │ Panel  │    │   │
│  │   └─────────┴──────────┴──────────┴────────┴────────┘    │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Principio: datos estructurados cuando sea posible, parsing cuando sea necesario

| Dato | Fuente primaria | Fuente secundaria | Confiabilidad |
|------|----------------|-------------------|---------------|
| Tool calls (inicio) | Hooks (PreToolUse) | PTY parsing | Alta |
| Tool calls (resultado) | Hooks (PostToolUse) | PTY parsing | Alta |
| Agent spawn/done | Hooks (Agent tool) | PTY parsing | Alta |
| Agent names/types | Hooks (Agent tool input) | PTY parsing | Alta |
| Thinking content | PTY parsing | — | Media |
| Main output | PTY raw passthrough | — | Alta |
| File changes | chokidar (filesystem) | PTY parsing | Alta |

### 3.3 Garantía de no-invasividad

1. Hooks son **aditivos** (se agregan al array existente, nunca reemplazan)
2. Fallos de hooks son **silenciosos** (siempre pasan stdin sin modificar)
3. PTY parsing es **read-only** (nunca inyecta input excepto keystrokes del usuario)
4. File watcher es **pasivo** (solo lectura)
5. Variables de entorno usan prefijo `MC_` para evitar conflictos

---

## 4. Cross-platform

### 4.1 Diferencias por plataforma

```
┌───────────────────┬───────────────────┬───────────────────┐
│     Linux         │     macOS         │     Windows       │
├───────────────────┼───────────────────┼───────────────────┤
│ Unix PTY (forkpty)│ Unix PTY (forkpty)│ ConPTY (Win10+)   │
│ /dev/pts/*        │ /dev/ttys*        │ Named pipe        │
│ LF (\n)           │ LF (\n)           │ CRLF (\r\n)       │
│ TERM=xterm-256    │ TERM=xterm-256    │ TERM puede faltar │
│ Full ANSI         │ Full ANSI         │ VT100 subset*     │
│ SIGWINCH resize   │ SIGWINCH resize   │ process.stdout    │
│ inotify           │ FSEvents          │ ReadDirChangesW   │
└───────────────────┴───────────────────┴───────────────────┘

* Windows Terminal soporta ANSI completo. CMD legacy es el limitado.
```

### 4.2 Capa de abstracción de plataforma

```typescript
interface PlatformCapabilities {
  trueColor: boolean;
  unicodeBorders: boolean;
  mouseSupport: boolean;
  resizeEvent: 'signal' | 'poll';
  lineEnding: '\n' | '\r\n';
}
```

Detección al startup:
- `process.env.WT_SESSION` → Windows Terminal (full capabilities)
- `process.platform === 'win32'` sin WT_SESSION → CMD legacy (degraded)
- Demás → full capabilities

### 4.3 IPC cross-platform

```typescript
function getIpcPath(sessionId: string): string {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\mission-control-${sessionId}`;
  }
  return path.join(os.tmpdir(), `mission-control-${sessionId}.sock`);
}
```

Node.js `net.createServer` maneja ambos nativamente con la misma API.

### 4.4 Normalización de PTY output

```typescript
function normalizePtyOutput(data: string): string {
  return data.replace(/\r\n/g, '\n').replace(/\r(?!\n)/g, '\n');
}
```

Se aplica en la capa del PTY adapter, ANTES de llegar al parser.

### 4.5 Resize handling

- macOS/Linux: `SIGWINCH` → inmediato
- Windows: `process.stdout.on('resize')` + poll cada 500ms como backup

### 4.6 Requisitos mínimos por plataforma

| Plataforma | Versión mínima | Notas |
|---|---|---|
| macOS | Monterey 12+ | Terminal.app o iTerm2 |
| Linux | Kernel 4.x+ | Cualquier terminal con 256 colores |
| Windows | 10 v1809+ (Oct 2018) | **Windows Terminal recomendado**. CMD funciona degradado |
| Node.js | 22+ | Todas las plataformas |
| Claude Code | Última versión | `claude` en PATH |

---

## 5. Sistema de hooks (Hybrid Events)

### 5.1 Cómo funciona

Claude Code ejecuta hooks como procesos separados. Les pasa JSON por stdin con datos del tool call. Nuestros hooks reenvían ese JSON al TUI via IPC.

```
Claude Code                   Hook script              Mission Control
┌──────────┐    stdin JSON    ┌───────────┐   socket   ┌────────────┐
│ PreTool  │ ───────────────▶ │ hook-fwd  │ ────────▶  │ IPC Server │
│ Use      │                  │ .js       │            │            │
└──────────┘                  └───────────┘            │ Parse JSON │
                                   │                   │ → EventBus │
                              exit 0 (allow)           └────────────┘
```

### 5.2 Hook script (minimal, se instala automáticamente)

```javascript
#!/usr/bin/env node
const net = require('net');
const ipcPath = process.env.MC_IPC_PATH;

// Si MC no está corriendo, pass-through silencioso
if (!ipcPath) process.exit(0);

let raw = '';
process.stdin.on('data', chunk => { raw += chunk; });
process.stdin.on('end', () => {
  const client = net.createConnection(ipcPath, () => {
    client.write(JSON.stringify({
      hookType: process.argv[2], // 'PreToolUse' | 'PostToolUse' | 'Stop'
      timestamp: Date.now(),
      payload: JSON.parse(raw)
    }) + '\n');
    client.end();
  });
  client.on('error', () => {});  // MC no está corriendo, ignorar
});
```

### 5.3 Configuración automática de hooks

Al iniciar Mission Control:

1. Leer settings actuales (`.claude/settings.local.json` del proyecto)
2. Guardar backup: `settings.local.json.mc-backup`
3. **Agregar** (no reemplazar) hooks de MC al array PreToolUse/PostToolUse/Stop
4. Escribir lock file `/tmp/mission-control-{pid}.lock`
5. Lanzar Claude Code PTY

Al cerrar (normal o SIGTERM/SIGINT):

1. Matar Claude Code PTY
2. Restaurar settings desde backup
3. Eliminar lock file y socket

Crash recovery (al re-iniciar):

1. Verificar lock files huérfanos
2. Si PID muerto → restaurar settings desde backup
3. Continuar startup normal

### 5.4 Qué nos dan los hooks

| Hook | Evento | Datos |
|------|--------|-------|
| PreToolUse (tool=*) | `hook:tool_start` | tool_name, tool_input, server |
| PostToolUse (tool=*) | `hook:tool_end` | tool_name, tool_input, tool_output, success |
| PreToolUse (tool=Agent) | `hook:agent_spawn` | agent type, prompt, model |
| PostToolUse (tool=Agent) | `hook:agent_done` | agent output, confidence |
| Stop | `hook:stop` | stop reason |

El tool `Agent` de Claude Code IS un tool — dispara PreToolUse/PostToolUse como cualquier otro. Esto nos da lifecycle de agentes estructurado sin regex.

---

## 6. Parser design

### 6.1 Pipeline de matchers

```
PTY raw bytes
     │
     ▼
[Line Accumulator] ── bufferea líneas parciales, emite completas
     │
     ▼
[ANSI Stripper] ── strip-ansi para matching, preserva original
     │
     ▼
[Matcher Pipeline] ── ordenado por prioridad
     │
     ├── ThinkingMatcher     (high confidence, stateful)
     ├── AgentSpawnMatcher   (high confidence)
     ├── AgentOutputMatcher  (high confidence, stateful)
     ├── ToolUseMatcher      (medium — preferir datos de hook)
     ├── FileEditMatcher     (medium)
     ├── ErrorMatcher        (high confidence)
     ├── DefaultMatcher      (low — catch-all → main panel)
     │
     ▼
[Correlation Engine] ── merge con eventos de hooks
     │
     ▼
[EventBus dispatch]
```

### 6.2 Interface del Matcher

```typescript
interface Matcher {
  readonly name: string;
  readonly targetPanel: PanelType;
  readonly confidence: 'high' | 'medium' | 'low';
  match(cleanLine: string): MatchResult | null;
}

interface StatefulMatcher extends Matcher {
  isActive: boolean;
  enterCondition(line: string): boolean;
  exitCondition(line: string): boolean;
  // Mientras active, todas las líneas van a este matcher
}

interface MatchResult {
  type: ChunkType;
  confidence: 'high' | 'medium' | 'low';
  displayText: string;   // original con ANSI (para render)
  cleanText: string;     // sin ANSI (para lógica)
  metadata?: Record<string, unknown>;
}
```

### 6.3 Matchers stateful (multi-línea)

Para bloques de thinking que abarcan múltiples líneas:

```
ThinkingMatcher:
  enterCondition: /⚡\s*Thinking/i || /thinking:/i || /extended.?thinking/i
  exitCondition: siguiente tool call || prompt || línea vacía + cambio de contexto
  → Mientras activo, TODA línea va al panel THINKING
```

Para output de agentes:
```
AgentOutputMatcher:
  enterCondition: hook:agent_spawn recibido
  exitCondition: hook:agent_done recibido
  → Mientras activo, líneas con contexto de agente van al panel AGENT-N
```

### 6.4 Resolución de conflictos

- Dos matchers misma confianza, mismo panel → primer match gana (orden de prioridad)
- Dos matchers misma confianza, panel diferente → enviar a `main` (safe default)
- Nunca se pierde contenido. El peor caso es contenido en el panel equivocado

### 6.5 Patrones regex por matcher

Los patrones se cargan de un registry configurable. Conjunto inicial:

```
THINKING:
  /⚡\s*Thinking/i
  /\bthinking\b.*:/i
  /extended.?thinking/i

AGENT (spawn):
  /[Ss]pawned?\s+(agent|sub[_-]?agent)/
  /creating\s+agent/i
  /⊞\s*[Ss]pawn/
  /Running agent:/i

AGENT (done):
  /returned?\s+to\s+main/i
  /agent.*\b(done|complete|finished)\b/i
  /Agent completed/i

TOOL/MCP:
  /Tool:\s*(\S+)/i
  /tool_use\b/i
  /tool_result\b/i
  /(\w+)\.(read|write|search|query|list|glob|create|delete)\b/

FILE EDIT:
  /[Mm]odified:\s*(.+)/
  /[Cc]reated:\s*(.+)/
  /[Dd]eleted:\s*(.+)/
  /[Ww]r[io]te\s+to\s+(.+)/
  /Edit(?:ed|ing)?\s+(.+\.\w{1,6})/

ERROR:
  /Error:/i
  /✗|✘|❌/
  /FAIL|FAILED/i
  /panic:|fatal:/i
```

---

## 7. Layout dinámico

### 7.1 State machine

```
States:
  SOLO      ── Main terminal only (0 agents)
  SINGLE    ── Main + 1 agent panel
  DUAL      ── Main + 2 agent panels
  COMPACT   ── Layout mínimo (terminal < 100 cols)

Transitions:
  SOLO    → SINGLE   : agent_spawn
  SINGLE  → DUAL     : second agent_spawn
  DUAL    → SINGLE   : agent_done (uno de dos)
  SINGLE  → SOLO     : agent_done (último)
  ANY     → COMPACT  : terminal < 100 cols o < 25 rows
```

### 7.2 Estado SOLO — Sin sub-agentes

```
┌──────── Claude Mission Control ─── ● 0 agents ─────────┐
│                              │                          │
│  MAIN terminal               │  THINKING               │
│  (ocupa todo el lado         │  reasoning...            │
│   izquierdo)                 │                          │
│                              ├──────────────────────────┤
│                              │  MCP                     │
│  > prompt del usuario        │  ✓ fs.read file.tsx     │
│  output de claude code...    ├──────────────────────────┤
│                              │  FILES                   │
│                              │  M AgentsPage.tsx        │
│  ┌────────────────────────┐  │  A new-file.ts           │
│  │ > input               █│  │                          │
│  └────────────────────────┘  │                          │
└──────────────────────────────┴──────────────────────────┘
```

- Main: left 0%, width 65%, top=header, bottom=input
- Thinking: right 65%, top third
- MCP: right 65%, middle third
- Files: right 65%, bottom third

### 7.3 Estado SINGLE — 1 sub-agente

```
┌──────── Claude Mission Control ─── ● 1 agent ──────────┐
│                              │                          │
│  MAIN terminal               │  THINKING               │
│  (parte superior izquierda)  │  reasoning...            │
│                              ├──────────────────────────┤
├──────────────────────────────┤  MCP                     │
│                              │  ✓ fs.read file.tsx     │
│  AGENT-1 ● active            ├──────────────────────────┤
│  ✓ Found filter context     │  FILES                   │
│  → Wiring hook...            │  M AgentsPage.tsx        │
│  ┌────────────────────────┐  │  A new-file.ts           │
│  │ > input               █│  │                          │
│  └────────────────────────┘  │                          │
└──────────────────────────────┴──────────────────────────┘
```

- Main: 55% vertical del lado izquierdo
- Agent-1: 45% restante debajo
- Columna derecha: sin cambio

### 7.4 Estado DUAL — 2 sub-agentes

```
┌──────── Claude Mission Control ─── ● 2 agents ─────────┐
│                              │                          │
│  MAIN terminal               │  THINKING               │
│  (parte superior)            │  reasoning...            │
│                              ├──────────────────────────┤
├──────────────┬───────────────┤  MCP                     │
│              │               │  ✓ fs.read file.tsx     │
│  AGENT-1     │  AGENT-2      ├──────────────────────────┤
│  ✓ done     │  ⟳ working   │  FILES                   │
│              │  → tracing..  │  M AgentsPage.tsx        │
│  ┌───────────┴───────────┐   │                          │
│  │ > input              █│   │                          │
│  └───────────────────────┘   │                          │
└──────────────────────────────┴──────────────────────────┘
```

- Main: 45% vertical
- Agent-1 + Agent-2: 55% inferior, dividido en 2 columnas
- Si un agente termina, borde cambia a gris, badge "done"

### 7.5 Regla de overflow

3er agente: el más antiguo con status "done" se reemplaza. Si ambos activos, el 3ro se encola.

Header muestra: `● 2 agents + 1 queued`

Output del encolado se acumula en background. Cuando un slot se libera, se vuelca al panel.

### 7.6 Estado COMPACT — Terminal pequeña

Si cols < 100 o rows < 25, todo se apila verticalmente:
- Main: 100% width, 70% height
- Status bar con info comprimida de thinking/MCP/files
- Sin paneles laterales

---

## 8. Diseño visual

### 8.1 Paleta de colores

```
Background:          #0d1117
Panel background:    #0d1117
Header background:   #161b22
Border inactive:     #21262d
Text primary:        #c9d1d9
Text secondary:      #8b949e
Text dim:            #484f58
```

### 8.2 Colores por panel

| Panel | Borde | Tag BG | Tag Text |
|---|---|---|---|
| MAIN | #58a6ff | #1f3a5f | #58a6ff |
| AGENT-N | #bc8cff | #2d1f3a | #bc8cff |
| THINKING | #f0c050 | #3a2f1f | #f0c050 |
| MCP | #5dca7a | #1f3a2a | #5dca7a |
| FILES | #f06080 | #3a1f2a | #f06080 |

### 8.3 Badges de archivos

| Badge | BG | Text | Significado |
|---|---|---|---|
| M | #2d1f00 | #f0c050 | Modified |
| A | #0d2818 | #5dca7a | Added |
| D | #3a1520 | #f06080 | Deleted |

### 8.4 Estados de agentes

| Estado | Borde | Badge |
|---|---|---|
| active | #bc8cff | "active" |
| done | #484f58 (gris) | "done" verde |
| error | #f06080 | "error" rojo |
| queued | #484f58 | "queued" gris |

### 8.5 Header bar

```
●  Claude Mission Control  │  ● N agents  │  N tools  │  N files  │  tab=focus q=quit
```

### 8.6 Iconografía

```
✓  — éxito          ✗  — error           ⟳  — pendiente
●  — estado (dot)   →  — en progreso     ──  — separador
```

---

## 9. Controles de teclado

| Tecla | Contexto | Acción |
|---|---|---|
| Tab | Cualquiera | Cicla foco: input → main → agent-1 → agent-2 → thinking → input |
| Enter | Input enfocado | Envía texto al PTY |
| ↑ / ↓ | Panel enfocado | Scroll vertical |
| q | Input NO enfocado | Sale de la app |
| Ctrl+C | Cualquiera | Single: forward a PTY. Double (< 500ms): sale de MC |
| Escape | Cualquiera | Devuelve foco al input |

---

## 10. Estructura de archivos

```
claude-mission-control/
├── package.json
├── tsconfig.json
├── PLAN.md
│
├── src/
│   ├── index.ts                       ← Entry point, orquestación
│   ├── app.ts                         ← Application lifecycle
│   ├── types.ts                       ← Todos los tipos e interfaces
│   ├── constants.ts                   ← Defaults, magic numbers
│   │
│   ├── core/
│   │   ├── event-bus.ts               ← Sistema de eventos tipado central
│   │   ├── platform.ts               ← Detección de capabilities
│   │   └── config.ts                 ← Configuración y defaults
│   │
│   ├── pty/
│   │   ├── pty-adapter.ts            ← Abstracción cross-platform sobre node-pty
│   │   └── pty-buffer.ts             ← Buffering y acumulación de líneas
│   │
│   ├── hooks/
│   │   ├── hook-installer.ts         ← Inyecta/remueve hooks en settings.json
│   │   ├── hook-server.ts            ← IPC server (socket/named pipe)
│   │   └── hook-forward.js           ← Script que Claude Code ejecuta como hook
│   │
│   ├── parser/
│   │   ├── matcher-pipeline.ts       ← Registro y ejecución de matchers
│   │   ├── correlation.ts            ← Merge de matches PTY con eventos hook
│   │   └── matchers/
│   │       ├── thinking.ts           ← ThinkingMatcher (stateful)
│   │       ├── agent.ts              ← AgentSpawnMatcher + AgentOutputMatcher
│   │       ├── tool-use.ts           ← ToolUseMatcher
│   │       ├── file-edit.ts          ← FileEditMatcher
│   │       ├── error.ts              ← ErrorMatcher
│   │       └── default.ts            ← DefaultMatcher (catch-all → main)
│   │
│   ├── layout/
│   │   ├── layout-manager.ts         ← State machine de layout dinámico
│   │   ├── layout-states.ts          ← Configuraciones de posición por estado
│   │   └── focus-manager.ts          ← Tab cycling, keyboard focus
│   │
│   ├── panels/
│   │   ├── base-panel.ts             ← Clase base con ring buffer, scroll, render
│   │   ├── header.ts                 ← Barra superior con contadores
│   │   ├── main-panel.ts             ← Terminal principal (ANSI passthrough)
│   │   ├── agent-panel.ts            ← Panel de sub-agente (reusable)
│   │   ├── thinking-panel.ts         ← Stream de razonamiento
│   │   ├── mcp-panel.ts              ← Tool calls MCP
│   │   ├── files-panel.ts            ← Cambios de archivos
│   │   └── input-bar.ts              ← Barra de input del usuario
│   │
│   ├── watchers/
│   │   └── file-watcher.ts           ← chokidar wrapper con deduplicación
│   │
│   └── ui/
│       ├── screen.ts                 ← Inicialización de blessed screen
│       ├── render-scheduler.ts       ← Render coalescing adaptativo
│       └── theme.ts                  ← Colores, estilos, iconos
│
├── scripts/
│   └── postinstall.ts                ← Verifica node-pty build, da instrucciones si falla
│
└── tests/
    ├── parser/
    │   ├── thinking-matcher.test.ts
    │   ├── agent-matcher.test.ts
    │   ├── tool-use-matcher.test.ts
    │   └── pipeline.test.ts
    ├── core/
    │   ├── event-bus.test.ts
    │   └── platform.test.ts
    ├── layout/
    │   └── layout-manager.test.ts
    └── hooks/
        └── hook-server.test.ts
```

---

## 11. Tipos core

```typescript
// ── Event types ──

type MCEvent =
  | { type: 'pty:data'; raw: string; normalized: string }
  | { type: 'pty:exit'; code: number; signal?: string }
  | { type: 'hook:tool_start'; toolName: string; toolInput: unknown; timestamp: number }
  | { type: 'hook:tool_end'; toolName: string; toolOutput: unknown; success: boolean; timestamp: number }
  | { type: 'hook:agent_spawn'; agentType: string; prompt: string; model?: string; timestamp: number }
  | { type: 'hook:agent_done'; output: string; confidence?: number; timestamp: number }
  | { type: 'hook:stop'; reason: string; timestamp: number }
  | { type: 'file:change'; filePath: string; changeType: FileChangeType; timestamp: number }
  | { type: 'parser:chunk'; chunk: ParsedChunk }
  | { type: 'layout:recalculate'; reason: string }
  | { type: 'input:submit'; text: string }
  | { type: 'app:resize'; cols: number; rows: number }

type FileChangeType = 'M' | 'A' | 'D';

// ── Parser types ──

type ChunkType = 'main' | 'thinking' | 'subagent' | 'mcp' | 'file_edit' | 'error';

type PanelType = 'main' | 'thinking' | 'mcp' | 'files' | 'agent';

interface ParsedChunk {
  type: ChunkType;
  raw: string;
  clean: string;
  timestamp: number;
  confidence: 'high' | 'medium' | 'low';
  metadata?: AgentMetadata | ToolMetadata | FileMetadata;
}

interface AgentMetadata {
  agentId: string;
  agentName?: string;
  agentType?: string;
  status: 'spawn' | 'running' | 'done' | 'error';
}

interface ToolMetadata {
  toolName: string;
  server?: string;
  status: 'pending' | 'success' | 'error';
}

interface FileMetadata {
  filePath: string;
  changeType: FileChangeType;
}

// ── Layout types ──

type LayoutState = 'solo' | 'single' | 'dual' | 'compact';

interface PanelPosition {
  left: number | string;
  top: number | string;
  width: number | string;
  height: number | string;
}

// ── Agent tracking ──

type AgentStatus = 'active' | 'done' | 'error' | 'queued';

interface TrackedAgent {
  id: string;
  name: string;
  type: string;
  status: AgentStatus;
  spawnedAt: number;
  completedAt?: number;
  panelSlot?: 0 | 1;
}

// ── Platform ──

interface PlatformCapabilities {
  trueColor: boolean;
  unicodeBorders: boolean;
  mouseSupport: boolean;
  resizeEvent: 'signal' | 'poll';
  lineEnding: '\n' | '\r\n';
  ipcType: 'unix-socket' | 'named-pipe';
}
```

---

## 12. Componentes clave — diseño detallado

### 12.1 EventBus

Typed pub/sub central. Todos los componentes publican y suscriben eventos aquí.

```typescript
class EventBus {
  private listeners: Map<MCEvent['type'], Set<(event: MCEvent) => void>>;

  on<T extends MCEvent['type']>(type: T, handler: (event: Extract<MCEvent, { type: T }>) => void): void;
  emit(event: MCEvent): void;
  off(type: MCEvent['type'], handler: Function): void;
}
```

### 12.2 RenderScheduler

Coalesced rendering con frame rate adaptativo:

```typescript
class RenderScheduler {
  private dirty: Set<string> = new Set();
  private scheduled = false;
  private frameInterval = 16; // 60fps default

  markDirty(panelId: string): void {
    this.dirty.add(panelId);
    if (!this.scheduled) {
      this.scheduled = true;
      setTimeout(() => this.flush(), this.frameInterval);
    }
  }

  private flush(): void {
    const start = performance.now();
    this.scheduled = false;

    for (const panelId of this.dirty) {
      panels.get(panelId)?.render();
    }
    this.dirty.clear();
    screen.render();

    // Adaptar frame rate según carga real
    const elapsed = performance.now() - start;
    this.adaptFrameRate(elapsed);
  }

  private adaptFrameRate(lastRenderMs: number): void {
    if (lastRenderMs > 24) {      // >24ms → bajar a 30fps
      this.frameInterval = Math.min(this.frameInterval * 1.5, 50);
    } else if (lastRenderMs < 8) { // <8ms → subir hasta 60fps
      this.frameInterval = Math.max(this.frameInterval * 0.8, 16);
    }
  }
}
```

### 12.3 BasePanel (ring buffer)

Todas las panels extienden de aquí:

```typescript
abstract class BasePanel {
  protected buffer: string[];
  protected maxLines: number;
  protected element: blessed.Widgets.ScrollableBoxElement;

  appendLine(text: string): void {
    this.buffer.push(text);
    if (this.buffer.length > this.maxLines) {
      this.buffer.shift();
    }
    // pushLine es O(1) vs setContent que es O(n)
    this.element.pushLine(text);
    renderScheduler.markDirty(this.id);
  }
}
```

Buffer sizes por panel:
- Main: 1000 líneas (el usuario scrollea más aquí)
- Agent: 500 líneas
- Thinking: 200 líneas (alto volumen, bajo valor de scroll-back)
- MCP: 300 líneas
- Files: 50 entradas (con deduplicación)

### 12.4 PTY Buffer

Acumula bytes parciales y emite líneas completas:

```typescript
class PTYBuffer {
  private buffer = '';
  private flushTimer: NodeJS.Timeout | null = null;

  onData(data: string): void {
    this.buffer += normalize(data);

    if (this.buffer.includes('\n')) {
      this.flushCompleteLines();
    }

    // Timer para líneas parciales (prompts que no terminan en \n)
    if (this.flushTimer) clearTimeout(this.flushTimer);
    this.flushTimer = setTimeout(() => this.flushPartial(), 50);
  }
}
```

---

## 13. Flujo de datos completo

```
1. Usuario escribe en input-bar
       │
       ▼
2. pty-adapter.write(text + '\r')
       │
       ▼
3. Claude Code procesa en el PTY
       │
       ├──────────────────────────────────────┐
       ▼                                      ▼
4a. pty onData(raw)                    4b. Hook fires (PreToolUse)
       │                                      │
       ▼                                      ▼
5a. PTYBuffer.onData(raw)             5b. hook-forward.js → IPC socket
       │                                      │
       ▼                                      ▼
6a. Emite líneas completas             6b. HookServer.onConnection()
       │                                      │
       ▼                                      ▼
7a. MatcherPipeline.process(line)      7b. EventBus.emit(hook:tool_start)
       │                                      │
       ▼                                      │
8a. EventBus.emit(parser:chunk)        │      │
       │                                      │
       ├──────────────────────────────────────┘
       ▼
9. CorrelationEngine.correlate()
   (merge hook events con PTY chunks)
       │
       ▼
10. PanelRouter → panel correcto
       │
       ▼
11. panel.appendLine(text)
       │
       ▼
12. RenderScheduler.markDirty(panelId)
       │
       ▼
13. screen.render() (batched, 60fps max)

   En paralelo:
   FileWatcher → EventBus → FilesPanel
```

---

## 14. Manejo de errores

| Escenario | Comportamiento |
|---|---|
| `claude` no en PATH | Error en MAIN: "claude not found. Install: npm i -g @anthropic-ai/claude-code" |
| node-pty build falla | postinstall script da instrucciones por OS |
| PTY cierra inesperadamente | "[process exited: N]" en MAIN, paneles congelados, input disabled |
| Claude Code crash | Exit code !== 0, stderr en MAIN |
| Terminal muy pequeña | Layout COMPACT automático |
| chokidar falla (permisos) | Warning en FILES: "Watch disabled". Resto funciona |
| Hook IPC falla | Fall back a PTY-only mode. Log the gap |
| Hook server no inicia | PTY-only mode. Warning en header |
| Parser no reconoce línea | Va a MAIN panel (safe default) |
| Stale lock file | Verificar PID, restaurar settings, limpiar |

---

## 15. Performance

### 15.1 Budget por frame (16.67ms @ 60fps)

```
Event processing:     ~1ms
Panel content update: ~2ms (ring buffer append)
blessed render:       ~5ms (differential)
Terminal write:       ~3ms (stdout)
Overhead:             ~2ms (GC, event loop)
─────────────────────────────
Total:                ~13ms (3.67ms margen)
```

### 15.2 Optimizaciones

1. **Render coalescing** — múltiples updates en un solo screen.render()
2. **pushLine() no setContent()** — O(1) append vs O(n) full parse
3. **Ring buffers** — memoria acotada, sin crecimiento indefinido
4. **Adaptive frame rate** — baja a 30fps si la carga es alta
5. **PTY buffering** — agrupa bytes en líneas antes de parsear
6. **setImmediate** entre batches — evita event loop starvation
7. **Lazy panel creation** — agent panels solo se crean al spawn

### 15.3 Memoria estimada

```
Node + blessed + node-pty:  ~30-50MB base
Ring buffers (6 panels):    ~600KB
chokidar:                   ~5-10MB
Hook server:                ~2MB
─────────────────────────────
Total:                      ~50-70MB
```

---

## 16. Fases de implementación

### Fase 1 — Foundation (core + paneles estáticos)

**Archivos:** `types.ts`, `constants.ts`, `core/*`, `pty/*`, `ui/*`, `panels/*` (sin agent-panel), `index.ts`, `app.ts`

**Tareas:**
- [ ] Tipos e interfaces completos (`types.ts`)
- [ ] EventBus tipado (`core/event-bus.ts`)
- [ ] Detección de plataforma (`core/platform.ts`)
- [ ] PTY adapter cross-platform (`pty/pty-adapter.ts`)
- [ ] PTY buffer con acumulación de líneas (`pty/pty-buffer.ts`)
- [ ] Theme con colores y estilos (`ui/theme.ts`)
- [ ] Screen initialization (`ui/screen.ts`)
- [ ] RenderScheduler (`ui/render-scheduler.ts`)
- [ ] BasePanel con ring buffer (`panels/base-panel.ts`)
- [ ] Todos los paneles estáticos: main, thinking, mcp, files, header, input-bar
- [ ] Layout estático (Estado SOLO)
- [ ] Input bar funcional que envía al PTY
- [ ] Navegación Tab + scroll ↑↓
- [ ] Salida limpia con q y Ctrl+C
- [ ] Entry point (`index.ts`, `app.ts`)

**Resultado:** Claude Code corre dentro de la TUI con paneles estáticos. Todo el output va a MAIN. La app funciona como terminal wrapper básico.

### Fase 2 — Parser pipeline

**Archivos:** `parser/*`

**Tareas:**
- [ ] Matcher pipeline con registro de matchers (`parser/matcher-pipeline.ts`)
- [ ] ThinkingMatcher stateful (`parser/matchers/thinking.ts`)
- [ ] ToolUseMatcher (`parser/matchers/tool-use.ts`)
- [ ] FileEditMatcher (`parser/matchers/file-edit.ts`)
- [ ] ErrorMatcher (`parser/matchers/error.ts`)
- [ ] DefaultMatcher catch-all (`parser/matchers/default.ts`)
- [ ] Conectar pipeline al EventBus
- [ ] Tests unitarios para cada matcher
- [ ] Tests de integración del pipeline completo

**Resultado:** El output de Claude Code se clasifica en los paneles correctos. Thinking va a THINKING, tool calls a MCP, etc.

### Fase 3 — Hook system

**Archivos:** `hooks/*`

**Tareas:**
- [ ] IPC server cross-platform (`hooks/hook-server.ts`)
- [ ] Hook forward script (`hooks/hook-forward.js`)
- [ ] Hook installer que modifica settings.json (`hooks/hook-installer.ts`)
- [ ] Crash recovery (lock file + backup restore)
- [ ] Correlation engine (merge hook events con PTY chunks) (`parser/correlation.ts`)
- [ ] Tests del IPC server
- [ ] Tests del hook installer (mock settings.json)

**Resultado:** MCP panel muestra datos estructurados de hooks. Tool calls tienen status confiable (pending/success/error).

### Fase 4 — Agentes dinámicos

**Archivos:** `panels/agent-panel.ts`, `layout/*`, `parser/matchers/agent.ts`

**Tareas:**
- [ ] Agent panel reusable (`panels/agent-panel.ts`)
- [ ] AgentSpawnMatcher + AgentOutputMatcher (`parser/matchers/agent.ts`)
- [ ] Layout manager con state machine (`layout/layout-manager.ts`)
- [ ] Layout states con posiciones por estado (`layout/layout-states.ts`)
- [ ] Focus manager con ciclo de Tab dinámico (`layout/focus-manager.ts`)
- [ ] Transiciones animadas (recálculo de layout al spawn/done)
- [ ] Cola de overflow para 3+ agentes
- [ ] Correlación hook:agent_spawn con PTY output
- [ ] Tests del layout manager

**Resultado:** Agentes aparecen y desaparecen automáticamente. Layout se adapta en tiempo real.

### Fase 5 — File watcher + polish

**Archivos:** `watchers/file-watcher.ts`, `scripts/postinstall.ts`

**Tareas:**
- [ ] chokidar wrapper con eventos normalizados (`watchers/file-watcher.ts`)
- [ ] Deduplicación entre parser y watcher (mapa con timestamp)
- [ ] Resize handling (terminal resize → recalcular layout)
- [ ] Layout COMPACT para terminales pequeñas
- [ ] Manejo de errores robusto (todos los escenarios de la tabla)
- [ ] Postinstall script con instrucciones por OS
- [ ] Double Ctrl+C handling
- [ ] Testing cross-platform (CI matrix: ubuntu, macos, windows)

**Resultado:** Producto completo, robusto, cross-platform.

### Fase 6 — Distribución + extras (futuro)

- [ ] `tsup` bundle a single file
- [ ] npm publish como `claude-mission-control` con bin `cmc`
- [ ] Persistencia de logs: `~/.claude-mc/logs/`
- [ ] Replay: `cmc --replay session.log`
- [ ] `--output-format stream-json` mode (headless monitoring)
- [ ] Configuración opcional: `~/.claude-mc/config.json`

---

## 17. Testing strategy

### 17.1 Unit tests (vitest)

- Cada matcher: tabla de inputs → expected output
- EventBus: pub/sub, type safety
- Layout manager: state transitions
- PTY buffer: line accumulation, partial flush
- Platform detection: mock process.env/platform

### 17.2 Integration tests

- Parser pipeline: raw PTY output → classified chunks
- Hook server: IPC connection → event emission
- Correlation engine: hook events + PTY chunks → merged output

### 17.3 E2E tests (manual + automated)

- CI matrix: Ubuntu, macOS, Windows
- Spawn real `claude --help` en PTY, verificar output en panel
- Resize terminal, verificar layout recalculation
- Simular hook events via IPC, verificar MCP panel

### 17.4 Coverage targets

- Matchers: 100% (pure functions, easy to test)
- EventBus: 100%
- Layout manager: 100% (state machine)
- Panels: 80% (UI harder to test)
- Overall: 80%+

---

## 18. Riesgos y mitigaciones

| Riesgo | Probabilidad | Impacto | Mitigación |
|---|---|---|---|
| Claude Code cambia output format | Alta (6 meses) | Matchers rompen | Matchers configurables, diagnostic logging, fallback a MAIN |
| blessed bugs en Windows | Media | Visual corruption | Capability detection, fallback rendering, test matrix |
| Hook IPC race conditions | Baja | Eventos perdidos | Socket reconnect, hook-miss detection, PTY fallback |
| node-pty build falla en Windows | Media | No instala | prebuild-install binarios, postinstall con instrucciones |
| Memoria crece en sesiones largas | Baja | OOM | Ring buffers fijos, GC de agent panels detached |
| Performance bajo output pesado | Media | UI lag | Adaptive frame rate, render coalescing, PTY throttling |

---

## 19. package.json

```json
{
  "name": "claude-mission-control",
  "version": "0.1.0",
  "description": "TUI wrapper for Claude Code with real-time visibility into agents, thinking, tools, and file changes",
  "type": "module",
  "bin": {
    "cmc": "./dist/index.js"
  },
  "scripts": {
    "start": "tsx src/index.ts",
    "dev": "tsx watch src/index.ts",
    "build": "tsup src/index.ts --format esm --target node22",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "postinstall": "tsx scripts/postinstall.ts"
  },
  "dependencies": {
    "blessed": "^0.1.81",
    "node-pty": "^1.0.0",
    "chokidar": "^4.0.0",
    "strip-ansi": "^7.1.0"
  },
  "devDependencies": {
    "@types/blessed": "^0.1.25",
    "@types/node": "^22.0.0",
    "tsx": "^4.0.0",
    "tsup": "^8.0.0",
    "typescript": "^5.7.0",
    "vitest": "^2.0.0"
  },
  "engines": {
    "node": ">=22"
  },
  "os": ["darwin", "linux", "win32"]
}
```

---

## 20. Cómo correr

```bash
# Clonar e instalar
git clone <repo>
cd claude-mission-control
npm install

# Si node-pty falla:
# macOS: xcode-select --install && npm rebuild node-pty
# Linux: sudo apt install build-essential python3 && npm rebuild node-pty
# Windows: npm install -g windows-build-tools && npm rebuild node-pty

# Desarrollo
npm run dev

# Correr desde cualquier proyecto
cd ~/projects/mi-proyecto
node /ruta/a/claude-mission-control/src/index.ts

# Después de npm link
cd ~/projects/mi-proyecto
cmc
```

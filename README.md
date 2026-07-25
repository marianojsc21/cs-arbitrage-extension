# 🏛️ SaintProfit — Arbitraje CS2 entre CSFloat y Steam Market

**SaintProfit** (v2.3.0) es una extensión de navegador (Brave/Chrome) que encuentra oportunidades de **arbitraje de precios** entre **CSFloat** y **Steam Market** para artículos de Counter-Strike 2 (CS2).

Compara precios de **skins, cuchillos, guantes, pegatinas, cajas, agentes, llaveros, parches, lotes de música, coleccionables y graffiti**, calculando el profit real descontando la comisión del 15% de Steam.

---

## 📋 Tabla de Contenidos

- [Características](#-características)
- [Capturas](#-capturas)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Instalación](#-instalación)
- [Uso](#-uso)
- [Modos](#-modos)
- [Flujo de Escaneo](#-flujo-de-escaneo)
- [API y Fuentes de Datos](#-api-y-fuentes-de-datos)
- [Cálculo de Profit](#-cálculo-de-profit)
- [Historial de Búsquedas](#-historial-de-búsquedas)
- [Filtros](#-filtros)
- [Ordenamiento](#-ordenamiento)
- [Contador y Timer en Vivo](#-contador-y-timer-en-vivo)
- [Actualizaciones](#-actualizaciones)
- [Content Script (Badges en CSFloat)](#-content-script-badges-en-csfloat)
- [Solución de Problemas](#-solución-de-problemas)
- [Versiones](#-versiones)
- [Diseño](#-diseño)
- [Licencia](#-licencia)

---

## 🚀 Características

| Característica | Descripción |
|---|---|
| **Escaneo Inteligente** | Obtiene todos los items de CSFloat y los filtra antes de consultar Steam |
| **12 Categorías** | Skins, Cuchillos, Guantes, Pegatinas, Cajas, Agentes, Llaveros, Parches, Música, Coleccionables, Graffiti |
| **Profit Real** | Calcula ganancia descontando el 15% de comisión de Steam |
| **Modo Capitallet** | Modo inverso para convertir saldo Steam → Wallet CSFloat |
| **Filtros en Vivo** | Profit mínimo, rango de precio, categoría, orden — sin re-escanear |
| **Selector de Orden** | 8 opciones de ordenamiento para SteamFarm |
| **Contador + Timer** | 🔍 Items escaneados + ⏱️ tiempo transcurrido en tiempo real |
| **Historial Persistente** | Guarda resultados en localStorage con Top 7 por profit |
| **Top 7 Histórico** | Mejores oportunidades de todos los escaneos, visible en modo inactivo |
| **Auto-Restauración** | Al recargar la página se restaura el último escaneo automáticamente |
| **Detener Escaneo** | Botón para detener la búsqueda sin perder resultados parciales |
| **Tabla Ordenable** | Clic en cualquier columna de la tabla para ordenar ascendente/descendente |
| **Links Directos** | Iconos CSF → CSFloat y Steam → Steam Market por cada item |
| **Badges en CSFloat** | Content script que muestra badges de profit directamente en csfloat.com |
| **Auto-Update** | Sistema de actualización automática desde GitHub |
| **UI SaintProfit** | Paleta naranja + aqua · Glassmorphism · Animaciones · Diseño responsive |

---

## 📁 Estructura del Proyecto

```
saintprofit/
├── manifest.json           # Configuración de la extensión (Manifest V3)
├── app.html                # Página principal (SPA con CSS embebido)
├── popup.html              # Popup minimalista con selector de modos
├── README.md               # Esta documentación
├── .gitignore              # Archivos ignorados por git
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   ├── icon128.png
│   ├── icon256.png         # Logo para el header de app.html
│   ├── brand-header.jpeg   # Lettering SaintProfit
│   ├── lettering.png       # Lettering grande
│   ├── lettering-small.png # Lettering para popup
│   ├── csfloat-link.png    # Icono de link a CSFloat
│   └── steam-link.webp     # Icono de link a Steam
├── css/
│   └── styles.css          # Estilos para badges en CSFloat
└── js/
    ├── app.js              # Lógica principal: UI, APIs, historial, renderizado
    ├── background.js        # Service worker: proxy Steam, auto-update
    ├── content.js           # Content script para badges en CSFloat
    ├── init.js              # Mode switching, Top 7 histórico
    ├── popup.js             # Lógica del popup
    └── loader.js            # Cargador de archivos actualizados
```

### 📄 Descripción de Archivos

| Archivo | Rol |
|---|---|
| **manifest.json** | Manifiesto MV3: permisos, host_permissions, CSP, content_scripts |
| **app.html** | Single-page application con CSS embebido (~1600 líneas) y diseño grid |
| **popup.html** | Popup minimalista con selector de modos (SteamFarm / Capitallet) |
| **js/app.js** | IIFE auto-ejecutable (~900 líneas): UI, CSFloat API, Steam API, historial, render |
| **js/init.js** | Mode switching (active/inactive), renderizado Top 7 histórico, event delegation |
| **js/background.js** | Service worker: proxy de Steam, detección de actualizaciones |
| **js/content.js** | Inyectado en csfloat.com: detecta listings y muestra badges de profit |
| **js/popup.js** | Abre app.html con el modo seleccionado vía query param |
| **css/styles.css** | Badges flotantes con animación para CSFloat |

---

## 🔧 Instalación

### Requisitos

- **Brave** o **Chrome** (versión actualizada)
- Conocimientos básicos de CSFloat y Steam Market

### Instalación Manual (Desarrollador)

1. **Descargá el proyecto**
   ```bash
   git clone https://github.com/marianojsc21/cs-arbitrage-extension.git
   cd cs-arbitrage-extension
   ```

2. **Cargá la extensión en Brave/Chrome**
   - Abrí `brave://extensions` o `chrome://extensions`
   - Activá **"Modo desarrollador"** (toggle superior derecho)
   - Clic en **"Cargar descomprimida"**
   - Seleccioná la carpeta del proyecto

3. **Listo** 🎉
   - Hacé clic en el icono 🏛️ de SaintProfit en la barra
   - Elegí un modo y comenzá a escanear

---

## 🎮 Uso

### Popup de la Extensión

1. Hacé clic en el icono 🏛️ de SaintProfit en la barra de herramientas
2. Elegí entre **SteamFarm** o **Capitallet**
3. Se abre la app en una nueva pestaña con el modo seleccionado

### SteamFarm (app.html?mode=profit)

1. **Configurá los filtros** en la columna izquierda: Categoría, Profit Mínimo, Rango CSFloat, Límite, Orden
2. Hacé clic en **"🔍 Escanear"**
3. Seguí el progreso en vivo: contador de items + timer ⏱️
4. Revisá los resultados en la tabla, ordená por cualquier columna
5. Hacé clic en los iconos **CSF/Steam** para ver en cada plataforma
6. Usá el **📋 Historial** para recuperar búsquedas anteriores

### Capitallet (app.html?mode=capitallet)

1. **Configurá los filtros**: Categoría, Diferencia Máxima, Rango CSFloat, Límite, Orden
2. Hacé clic en **"🔍 Escanear"**
3. Revisá las coincidencias — buscá items con 🟢 ganancia (CSFloat > Steam)
4. Comprá en Steam, vendé en CSFloat para materializar tu saldo

### Cambio de Modo

Hacé clic en el título del modo ("SteamFarm" o "Capitallet") para intercambiarlos. El modo activo ocupa el espacio principal y el inactivo se reduce a una columna angosta con stats y Top 7 histórico.

---

## 🔄 Modos

### 💵 SteamFarm
Busca la **máxima diferencia** de precio donde CSFloat es barato y Steam es caro:
- **Compra en**: CSFloat
- **Vende en**: Steam (con comisión del 15%)
- **Resultado**: Profit en Steam Wallet
- **Score**: `quantity × (1 / min_price)` para priorizar items baratos con stock

### 💰 Capitallet
Busca la **mínima diferencia** de precio para convertir saldo Steam a CSFloat:
- **Compra en**: Steam (con saldo acumulado)
- **Vende en**: CSFloat
- **Resultado**: Saldo Steam → Wallet CSFloat
- Indicador visual 🟢 Ganancia / 🔴 Pérdida en cada fila

---

## 🔄 Flujo de Escaneo

```
1. GET https://csfloat.com/api/v1/listings/price-list
   ↓
2. Filtrar por precio (minPrice - maxPrice en centavos)
   ↓
3. Filtrar por stock (quantity >= 1)
   ↓
4. Filtrar por categoría (skins / knives / gloves / etc.)
   ↓
5. Ordenar por score = quantity × (1 / min_price)
   ↓
6. Tomar top N según límite configurado (15 / 30 / 50 / 100 / 200)
   ↓
7. Consultar Steam Market en lotes de 10
   ↓
8. Calcular profit (steam × 0.85 - csfloat) o diferencia
   ↓
9. Mostrar resultados en tabla ordenable
```

### Detalles Técnicos

| Aspecto | Detalle |
|---|---|
| **CSFloat API** | Endpoint público `/api/v1/listings/price-list` — sin autenticación |
| **Steam API** | `steamcommunity.com/market/priceoverview/` con headers anti-bloqueo |
| **Rate Limiting** | Lotes de 10 items, 2 segundos entre lotes |
| **Cache** | Steam cache de 30 minutos para evitar consultas duplicadas |
| **Timer** | ⏱️ setInterval con formato M:SS, se limpia en todos los exit paths |
| **Detención** | `scanning = false` interrumpe el loop en el siguiente lote |
| **Persistencia** | Resultados guardados en localStorage, auto-restauración al recargar |

---

## 📡 API y Fuentes de Datos

### CSFloat API

```http
GET https://csfloat.com/api/v1/listings/price-list
```

Respuesta: Array de objetos con:
```json
{
  "market_hash_name": "AK-47 | Redline (Field-Tested)",
  "min_price": 1500,        // Precio mínimo en centavos USD
  "quantity": 42            // Cantidad en stock
}
```

### Steam Market API

```http
GET https://steamcommunity.com/market/priceoverview/
    ?appid=730
    &currency=1
    &market_hash_name={nombre}
```

Headers adicionales para evitar bloqueos:
```
Accept: application/json
User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36
Referer: https://steamcommunity.com/market/
Origin: https://steamcommunity.com
```

---

## 💰 Cálculo de Profit

```
steam_price_real = steam_lowest_price × 0.85   (descontando 15% comisión)
profit_usd = steam_price_real - csfloat_price
profit_percent = ((steam_price_real - csfloat_price) / csfloat_price) × 100
```

### Ejemplo

| Item | CSFloat | Steam (bruto) | Steam (-15%) | Profit $ | Profit % |
|---|---|---|---|---|---|
| AK-47 Redline FT | $15.00 | $22.00 | $18.70 | +$3.70 | +24.7% |
| AWP Asiimov BS | $28.00 | $38.00 | $32.30 | +$4.30 | +15.4% |

### Categorías Detectadas Automáticamente

| Categoría | Palabras Clave |
|---|---|
| 🎯 Skins | (default) |
| 🔪 Cuchillos | knife, bayonet, karambit, m9, gut, falchion, ★ |
| 🧤 Guantes | gloves, wrap |
| 🏷️ Pegatinas | sticker |
| 📦 Cajas | case, capsule, package |
| 👤 Agentes | agent, operator |
| 🔑 Llaveros | keychain, charm |
| 🪡 Parches | patch |
| 🎵 Música | music kit |
| 🎖️ Coleccionables | collectible, medal, coin |
| 🎨 Graffiti | graffiti |

---

## 📋 Historial de Búsquedas

Cada escaneo se guarda automáticamente en **localStorage** con todos los datos necesarios para restauración.

### Datos Guardados por Entrada

| Campo | Descripción |
|---|---|
| `id` | Identificador único (timestamp + random) |
| `date` | Timestamp del escaneo |
| `label` | Fecha formateada local (es-AR) |
| `filters` | Categoría, Profit, Precios, Límite usados |
| `stats` | Total items, escaneados, profit promedio, mejor %, profit total |
| `topResults` | Top 7 items con mayor profit (nombre, precios, %) |
| `results` | Array completo de resultados para restauración |

### Funcionalidades

| Acción | Cómo |
|---|---|
| **Ver historial** | Clic en 📋 **Historial** en la barra de controles |
| **Restaurar escaneo** | Clic en cualquier entrada del historial |
| **Eliminar entrada** | Clic en ✕ en la entrada |
| **Borrar todo** | Clic en 🗑️ en el header del panel |
| **Auto-restauración** | Al recargar la página se restaura el último escaneo automáticamente |
| **Top 7 en el historial** | Cada entrada muestra inline sus mejores items |
| **Límite** | Máximo 20 entradas (las más viejas se descartan automáticamente) |

### Top 7 Histórico Global

En la columna del **modo inactivo** se muestra un **Top 7 global** que agrega los mejores items de TODOS los escaneos históricos (sin duplicados), ordenados por profit. Al hacer clic en un item, abre su página en CSFloat.

### Historial Separado por Modo

| Modo | Storage Key |
|---|---|
| SteamFarm | `saintprofit_history` |
| Capitallet | `saintprofit_cap_history` |

---

## 🎛️ Filtros

Los filtros están organizados en **2 tarjetas separadas** en la columna izquierda, una para cada modo. Funcionan **en vivo** sobre los resultados ya escaneados (sin re-escanear). Se guardan en localStorage entre sesiones.

### SteamFarm

| Filtro | Tipo | Default | Opciones |
|---|---|---|---|
| **Categoría** | Select | Todas | Skins, Cuchillos, Guantes, etc. (12 opciones) |
| **Profit Mínimo** | Número | 10% | 1–999% |
| **Precio CSFloat** | Número | $3 – $50 | Mín y máx (2 filas) |
| **Límite** | Select | 50 | 15 / 30 / 50 / 100 / 200 |
| **Orden** | Select | Profit % ↓ | 8 opciones de ordenamiento |

### Capitallet

| Filtro | Tipo | Default | Opciones |
|---|---|---|---|
| **Categoría** | Select | Todas | 12 opciones |
| **Precio CSFloat** | Número | $3 – $100 | Mín y máx (2 filas) |
| **Dif. Máx.** | Número | 5% | 0–100% |
| **Límite** | Select | 50 | 15 / 30 / 50 / 100 / 200 |
| **Orden** | Select | Menor dif. | 4 opciones de ordenamiento |

---

## 🔄 Ordenamiento

### SteamFarm — 8 Opciones de Orden

| Opción | Ordena por |
|---|---|
| ⬇ Profit % ↓ | Mayor profit porcentual primero (default) |
| ⬆ Profit % ↑ | Menor profit porcentual primero |
| ⬇ Profit $ ↓ | Mayor profit en dólares primero |
| ⬆ Profit $ ↑ | Menor profit en dólares primero |
| ⬆ CSFloat ↑ | Precio CSFloat más barato primero |
| ⬇ CSFloat ↓ | Precio CSFloat más caro primero |
| ⬇ Stock ↓ | Mayor stock primero |
| ⬆ Stock ↑ | Menor stock primero |

### Capitallet — 4 Opciones de Orden

| Opción | Ordena por |
|---|---|
| ⬆ Menor dif. | Menor diferencia porcentual (default) |
| ⬇ Mayor dif. | Mayor diferencia porcentual |
| ⬆ CSFloat ↑ | Precio CSFloat ascendente |
| ⬇ CSFloat ↓ | Precio CSFloat descendente |

Además, se puede hacer clic en cualquier **header de columna** de la tabla para ordenar ascendente/descendente.

---

## ⏱️ Contador y Timer en Vivo

Durante el escaneo se muestran en tiempo real:

```
📊 Lote 3/5 | Verificando 10 items... (5 con profit)
████████████████░░░░░░░░░░░░░░░░░ 45%
🔍 Items escaneados: 30 / 50     ⏱️ 1:23
```

- **Contador**: Se actualiza después de cada lote de 10 items
- **Timer**: Arranca al presionar "Escanear" (incluye el tiempo de obtener la lista de CSFloat)
- **Formato**: `M:SS` con `setInterval` de 1 segundo
- **Limpieza**: El timer se detiene al completar, detener manualmente, o si hay error
- **Independiente**: Cada modo tiene su propio timer y contador

---

## 🔄 Actualizaciones

El service worker (`js/background.js`) verifica actualizaciones cada hora desde GitHub:
```
https://raw.githubusercontent.com/marianojsc21/cs-arbitrage-extension/main/manifest.json
```

Si hay una versión más nueva, descarga los archivos actualizados y los almacena en `chrome.storage.local`.

### Archivos que se actualizan automáticamente:
- `js/app.js` · `js/content.js` · `js/popup.js` · `css/styles.css` · `popup.html` · `app.html`

---

## 🏷️ Content Script (Badges en CSFloat)

Cuando navegás en `csfloat.com` con la extensión activa:

1. **Detección de listings**: Encuentra elementos de listings en la página
2. **Consulta a Steam**: Obtiene precio de Steam vía background.js
3. **Cálculo de profit**: Misma fórmula (×0.85)
4. **Badge flotante**: Muestra CSFloat, Steam y Ganancia con color según %
   - 🟢 Aqua ≥30%
   - 🟡 Amarillo ≥20%
   - 🟠 Naranja ≥10%
   - 🔴 Rojo <10%
5. **Indicador global**: Badge "SaintProfit: ON / OFF" con dot animado
6. **Batch Processing**: Listings procesados en lotes de 5, con stagger de 300ms y 2.5s entre lotes

---

## 🔧 Solución de Problemas

### ❌ "No se encontraron listados en CSFloat"
**Causa**: CSFloat cambió su API o hay rate limiting.

**Solución**: 
1. Verificá que `https://csfloat.com` sea accesible
2. Esperá 30 segundos y reintentá

### ❌ Steam bloquea las consultas (429)
**Causa**: Demasiadas consultas a Steam Market en poco tiempo.

**Solución**: 
1. Bajá el límite de items a 15 o 30
2. Esperá 1 minuto entre escaneos
3. La extensión espera 2s entre lotes de 10 items

### ❌ "Extension context invalidated"
**Causa**: El service worker se recargó mientras el content script seguía activo.

**Solución**: Recargá la página de CSFloat. La extensión ahora maneja este error gracefulmente.

### ❌ Error CSP en consola
**Causa**: Una extensión de terceros o Brave intenta inyectar un script en la página de SaintProfit.

**Solución**: Es **inofensivo** — la extensión funciona correctamente de todos modos. Ignorar.

---

## 📌 Versiones

| Versión | Cambios |
|---|---|
| **v2.3.0** | ✨ Filtro "Orden" en SteamFarm (8 opciones) · Contador 🔍 y Timer ⏱️ en tiempo real · Timer cleanup en todos los exit paths · Refinamientos de padding y espaciado |
| **v2.2.0** | ✨ Dos tarjetas de filtros separadas · Híbrido labels/inputs (lado a lado + Precio CSFloat vertical) · Bordes inferiores corregidos · Dashboard padding refinado |
| **v2.1.0** | ✨ Layout 3-columnas · Modo inactivo se achica · Top 7 histórico global · Diseño responsive · Brand header con lettering |
| **v2.0.0** | ✨ **Rebrand**: CSMuza → **SaintProfit** · Paleta naranja + aqua · Popup minimalista · README actualizado |
| **v1.12.0** | Popup simplificado con selector de modos · URL-based tab selection |
| **v1.11.0** | Batch processing en content.js (5x más rápido) |
| **v1.10.0** | Indicador visual 🟢/🔴 en Capitallet · Filas coloreadas |
| **v1.9.0** | Historial de Capitallet con persistencia propia |
| **v1.8.0** | Modo Capitallet como pestaña separada |
| **v1.7.2** | Links CSF/STM en tabla · CSP explícito |
| **v1.5.0** | Diseño renovado · Categorías · Historial · Auto-restauración |
| **v1.0.0** | Versión inicial |

---

## 🎨 Diseño

### Paleta de Colores

| Color | Hex | Uso |
|---|---|---|
| 🟠 **Naranja** | `#ff6b35` | Acento principal, botones, headers (accent-1) |
| 🟠 **Naranja claro** | `#ff8c42` | Gradientes, timer (accent-2) |
| 🟢 **Aqua** | `#00d4aa` | Profit, contador, highlights (accent-3) |
| ⚫ **Negro** | `#0a0a0a` | Fondo principal |
| ⚪ **Blanco** | `#f0f0f0` | Texto primario |
| 🔘 **Gris** | `#666–#999` | Textos secundarios, bordes, muted |

### Efectos Visuales

- **Glassmorphism**: `backdrop-filter: blur(8px)` en tarjetas
- **Gradientes**: Botones con gradiente naranja + glow
- **Animaciones**: `slideDown`, `fadeIn`, `rowIn`, `shimmer`, `dot-pulse`, `stat-pulse`
- **Hover states**: Todos los elementos interactivos tienen transiciones suaves
- **Scrollbar**: Personalizada y sutil (6px, semi-transparente)
- **Fondo animado**: 3 gradientes radiales en posiciones fijas
- **Diseño responsive**: 3 breakpoints (full, ≤1100px, ≤700px)

### Fuente

- **Space Grotesk** vía Google Fonts — weights 300–700

---

## 📄 Licencia

Este proyecto es de uso personal y educativo. Los datos de CSFloat y Steam son propiedad de sus respectivos dueños.

---

<div align="center">
  <p>🏛️ Hecho con 🧡 para la comunidad CS2</p>
  <p>
    <a href="https://csfloat.com">CSFloat</a> ·
    <a href="https://steamcommunity.com/market">Steam Market</a>
  </p>
</div>

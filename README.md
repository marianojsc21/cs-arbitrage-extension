# 🎯 CSMuza — Profit Finder para CS2

**CSMuza** es una extensión de navegador (Chrome/Brave) que encuentra oportunidades de **arbitraje de precios** entre **CSFloat** y **Steam Market** para artículos de Counter-Strike 2 (CS2). Compara precios de skins, cuchillos, guantes, pegatinas, cajas, agentes y más, calculando el profit real descontando la comisión del 15% de Steam.

---

## 📋 Tabla de Contenidos

- [Características](#-características)
- [Estructura del Proyecto](#-estructura-del-proyecto)
- [Instalación](#-instalación)
- [Uso](#-uso)
- [Flujo de Escaneo](#-flujo-de-escaneo)
- [API y Fuentes de Datos](#-api-y-fuentes-de-datos)
- [Cálculo de Profit](#-cálculo-de-profit)
- [Historial de Búsquedas](#-historial-de-búsquedas)
- [Filtros](#-filtros)
- [Actualizaciones Automáticas](#-actualizaciones-automáticas)
- [Content Script (Badges en CSFloat)](#-content-script-badges-en-csfloat)
- [Solución de Problemas](#-solución-de-problemas)
- [Versiones](#-versiones)
- [Licencia](#-licencia)

---

## 🚀 Características

| Característica | Descripción |
|---|---|
| **Escaneo Inteligente** | Obtiene todos los items de CSFloat y los filtra antes de consultar Steam |
| **12 Categorías** | Skins, Cuchillos, Guantes, Pegatinas, Cajas, Agentes, Llaveros, Parches, Música, Coleccionables, Graffiti |
| **Profit Real** | Calcula ganancia descontando el 15% de comisión de Steam |
| **Filtros en Vivo** | Profit mínimo, rango de precio CSFloat, categoría — sin re-escanear |
| **Historial Persistente** | Guarda resultados en localStorage con Top 7 por profit |
| **Auto-Restauración** | Al recargar la página, se restaura el último escaneo automáticamente |
| **Detener Escaneo** | Botón para detener la búsqueda sin perder resultados parciales |
| **Ordenamiento** | Clic en cualquier columna de la tabla para ordenar |
| **Links Directos** | Botones CSF → CSFloat y STM → Steam Market por cada item |
| **Badges en CSFloat** | Content script que muestra badges de profit directamente en csfloat.com |
| **Auto-Update** | Sistema de actualización automática desde GitHub |
| **Diseño Gaming** | UI oscura con glassmorphism, animaciones y micro-interacciones |

---

## 📁 Estructura del Proyecto

```
csmuza/
├── manifest.json          # Configuración de la extensión (Manifest V3)
├── app.html               # Página principal del Profit Finder
├── popup.html             # Popup de la extensión
├── README.md              # Esta documentación
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
├── css/
│   └── styles.css         # Estilos para badges en CSFloat
└── js/
    ├── app.js             # Lógica principal del Profit Finder
    ├── background.js      # Service worker (API Steam, auto-update)
    ├── content.js         # Content script para badges en CSFloat
    ├── popup.js           # Lógica del popup
    └── loader.js          # Cargador de archivos actualizados
```

### 📄 Descripción de Archivos

| Archivo | Rol |
|---|---|
| **manifest.json** | Manifiesto MV3: permisos, host_permissions, CSP, content_scripts |
| **app.html** | Single-page application con CSS embebido (~700 líneas de estilo) |
| **popup.html** | Popup de 340px con configuración rápido |
| **js/app.js** | IIFE auto-ejecutable: UI, CSFloat API, Steam API, historial, renderizado |
| **js/background.js** | Service worker: proxy de Steam, detección de actualizaciones |
| **js/content.js** | Inyectado en csfloat.com: detecta listings y muestra badges de profit |
| **js/popup.js** | Guarda configuración, chequea actualizaciones, abre app.html |
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
   - Hacé clic en el icono de la extensión
   - Configurá tu Profit Mínimo y hacé clic en **"Abrir Profit Finder"**

### Instalación desde Chrome Web Store

*(Próximamente)*

---

## 🎮 Uso

### Popup de la Extensión

1. Hacé clic en el icono 🎯 de CSMuza en la barra de herramientas
2. Configurá:
   - **Profit Mínimo (%)**: Porcentaje mínimo de ganancia (default: 15%)
   - **Precio Máximo (USD)**: Precio máximo en CSFloat (default: $50)
   - **Auto-escaneo en CSFloat**: Badges de profit en listings
3. Hacé clic en **"Abrir Profit Finder"** → se abre en una nueva pestaña

### Profit Finder (app.html)

1. **Configurá los filtros**: Categoría, Profit Mínimo, Rango CSFloat, Límite
2. Hacé clic en **"🚀 Escanear"**
3. Esperá mientras se procesan los items
4. Revisá los resultados en la tabla, ordená por cualquier columna
5. Hacé clic en **CSF** para ver en CSFloat o **STM** para ver en Steam
6. Usá el **📋 Historial** para recuperar búsquedas anteriores

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
6. Tomar top N (15 / 30 / 50 / 100 / 200)
   ↓
7. Consultar Steam Market en lotes de 10
   ↓
8. Calcular profit (steam × 0.85 - csfloat)
   ↓
9. Mostrar resultados ordenados por profit USD
```

### Detalles Técnicos

- **CSFloat API**: Endpoint público `/api/v1/listings/price-list` — sin autenticación
- **Steam API**: `steamcommunity.com/market/priceoverview/` — con headers anti-bloqueo
- **Rate Limiting**: Lotes de 10 items, 2 segundos entre lotes
- **Cache**: Steam cache de 30 minutos para evitar consultas duplicadas
- **Detención**: `scanning = false` interrumpe el loop en el siguiente lote

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

La extensión detecta la categoría de cada item por su `market_hash_name`:

| Categoría | Palabras Clave |
|---|---|
| 🎯 Skins | (default) |
| 🔪 Cuchillos | knife, bayonet, karambit, m9, gut, falchion, navaja, stiletto, talon, ★ |
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

Cada escaneo se guarda automáticamente en **localStorage** con:

- **Fecha y hora** del escaneo
- **Filtros usados** (categoría, profit, precio, límite)
- **Estadísticas**: total items, escaneados, profit promedio, mejor %, profit total
- **Top 7 items** con mayor profit (inline en la card)
- **Resultados completos** para restauración

### Funcionalidades

| Acción | Cómo |
|---|---|
| **Ver historial** | Clic en 📋 **Historial** en la barra de controles |
| **Restaurar escaneo** | Clic en cualquier entrada del historial |
| **Eliminar entrada** | Clic en ✕ en la entrada |
| **Borrar todo** | Clic en 🗑️ en el header del panel |
| **Auto-restauración** | Al recargar la página se restaura el último escaneo |
| **Límite** | Máximo 20 entradas (las más viejas se descartan) |

---

## 🎛️ Filtros

| Filtro | Tipo | Default | Descripción |
|---|---|---|---|
| **Categoría** | Select | Todas | Filtra por tipo de item |
| **Profit Mínimo** | Número | 10% | % mínimo de ganancia |
| **Precio Min CSFloat** | Número | $3 | Precio mínimo en CSFloat |
| **Precio Max CSFloat** | Número | $50 | Precio máximo en CSFloat |
| **Límite** | Select | 50 | Items a escanear (15/30/50/100/200) |

Los filtros de **Profit**, **Precio** y **Categoría** funcionan **en vivo** sobre los resultados ya escaneados (sin re-escanear). Se guardan en localStorage entre sesiones.

---

## 🔄 Actualizaciones Automáticas

El service worker (`background.js`) verifica actualizaciones cada hora desde:
```
https://raw.githubusercontent.com/nisutalineage2-tech/csmuza/main/manifest.json
```

Si hay una versión más nueva:
1. Aparece un banner en el popup
2. Descargá la actualización → se descargan los archivos nuevos
3. Se almacenan en `chrome.storage.local` para la próxima carga

### Archivos que se actualizan:
- `js/app.js`
- `js/content.js`
- `js/popup.js`
- `css/styles.css`
- `popup.html`
- `app.html`

---

## 🏷️ Content Script (Badges en CSFloat)

Cuando navegás en `csfloat.com` con la extensión activa:

1. **Detección de listings**: Encuentra elementos de listings en la página
2. **Consulta a Steam**: Obtiene precio de Steam vía background.js
3. **Cálculo de profit**: Misma fórmula (×0.85)
4. **Badge flotante**: Muestra CSFloat, Steam y Ganancia con color según %
   - 🟢 Verde ≥30%
   - 🟡 Amarillo ≥20%
   - 🟠 Naranja ≥10%
   - 🔴 Rojo <10%
5. **Indicador global**: Badge "CSMuza: ON / OFF" con dot animado

### Configuración desde el popup:
- **Auto-escaneo en CSFloat**: ON/OFF
- **Profit Mínimo**: Solo muestra badges si supera este %

---

## 🔧 Solución de Problemas

### ❌ Error CSP: "inline event handler violates..."
**Causa**: Brave/Chrome MV3 bloquea `onclick` inline en HTML.

**Solución**: 
1. Recargá la extensión en `brave://extensions` (botón 🔄)
2. Si persiste, abrí desde el popup (no arrastrando el archivo)

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

### ❌ El botón queda rojo después de escanear
**Causa**: Bug de versión anterior.

**Solución**: Actualizá a v1.7.2 o superior. Recargá la extensión.

---

## 📌 Versiones

| Versión | Cambios |
|---|---|
| **v1.7.2** | Links CSF/STM en tabla · CSP explícito |
| **v1.7.1** | CSP explícito en manifest.json |
| **v1.7.0** | Top 7 en historial · Fix CSP inline onclick |
| **v1.6.0** | Botón Detener · classList.remove scanning |
| **v1.5.0** | Diseño renovado · Categorías · Historial · Auto-restauración |
| **v1.4.0** | Modo profit/steam · Filtros mejorados |
| **v1.3.0** | Historial de búsquedas con persistencia |
| **v1.2.0** | Filtros por categoría y límite de items |
| **v1.1.0** | Control de versiones · Logs de debug |
| **v1.0.0** | Versión inicial |

---

## 📄 Licencia

Este proyecto es de uso personal y educativo. Los datos de CSFloat y Steam son propiedad de sus respectivos dueños.

---

<div align="center">
  <p>Hecho con 🎯 para la comunidad CS2</p>
  <p>
    <a href="https://csfloat.com">CSFloat</a> ·
    <a href="https://steamcommunity.com/market">Steam Market</a>
  </p>
</div>

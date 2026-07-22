# CS2 Arbitrage Finder 🎯

Extensión para Brave/Chrome que detecta oportunidades de arbitraje entre **CSFloat** y **Steam Market** para items de Counter-Strike 2.

## 🚀 Instalación

1. Descargá la extensión: [git clone](https://github.com/marianojsc21/cs-arbitrage-extension) o descargá el ZIP
2. Abrí **Brave** (o Chrome) andá a: `brave://extensions` (`chrome://extensions`)
3. Activá **"Modo desarrollador"** (esquina superior derecha)
4. Hacé clic en **"Cargar descomprimida"**
5. Seleccioná la carpeta del proyecto

## 🎮 Cómo usar

1. Hacé clic en el icono de la extensión en la barra
2. Configurá los filtros:
   - **Profit mínimo (%)**: Solo muestra oportunidades con este % de ganancia mínimo
   - **Precio mínimo/máximo ($)**: Rango de precio en CSFloat
   - **Categoría**: Filtrá por tipo de item (skins, cuchillos, stickers, etc.)
   - **Páginas**: Cantidad de páginas a escanear (50 items por página)
3. Hacé clic en **"Escanear"**
4. Esperá mientras se comparan precios
5. Revisá los resultados ordenados por % de profit

## 📊 Items soportados

- 🎯 Skins y armas (con todos los estados: FN, MW, FT, WW, BS)
- 🔪 Cuchillos
- 🧤 Guantes
- 🏷️ Pegatinas (stickers)
- 📦 Cajas y contenedores
- 👤 Agentes
- 🔑 Llaveros (keychains/charms)
- 🎖️ Parches
- 🎵 Lotes de música
- 🏆 Coleccionables
- 🎨 Graffitis

## ⚙️ Tecnología

- **Manifest V3** para Brave/Chrome
- API pública de CSFloat para listings
- API de Steam Community Market para precios
- Caché inteligente de precios (10 min)
- Rate limiting automático para evitar baneos

## 🔑 API Key (opcional)

Para mejores resultados, obtené una API key de CSFloat:
- Andá a [csfloat.com](https://csfloat.com) > Perfil > Developer
- Agregá la key en `background.js` en el header `Authorization`

## 📝 Licencia

MIT

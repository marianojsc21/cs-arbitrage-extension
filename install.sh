#!/bin/bash
# CSFloat Profit Finder - Instalador
# Ejecutar con: ./install.sh

REPO="git@github.com:nisutalineage2-tech/csmuza.git"
INSTALL_DIR="$HOME/.csfloat-profit-finder"

echo "Instalando CSFloat Profit Finder..."

if [ -d "$INSTALL_DIR" ]; then
    echo "Ya instalado. Actualizando..."
    cd "$INSTALL_DIR" && git pull origin main
else
    echo "Clonando repositorio..."
    git clone "$REPO" "$INSTALL_DIR"
fi

chmod +x "$INSTALL_DIR/update.sh"

echo ""
echo "=========================================="
echo "  Instalado en: $INSTALL_DIR"
echo "=========================================="
echo ""
echo "Para usar:"
echo ""
echo "  CHROME:"
echo "  1. Abrir chrome://extensions/"
echo "  2. Activar 'Modo desarrollador'"
echo "  3. 'Cargar extension sin empaquetar'"
echo "  4. Seleccionar: $INSTALL_DIR"
echo ""
echo "  FIREFOX:"
echo "  1. Abrir about:debugging#/runtime/this-firefox"
echo "  2. 'Cargar componente temporal'"
echo "  3. Seleccionar: $INSTALL_DIR/manifest.json"
echo ""
echo "Para actualizar:"
echo "  $INSTALL_DIR/update.sh"
echo ""

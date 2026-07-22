#!/bin/bash
# CSFloat Profit Finder - Auto Update
# Ejecutar con: ./update.sh

REPO="git@github.com:nisutalineage2-tech/csmuza.git"
DIR="$(cd "$(dirname "$0")" && pwd)"

echo "Actualizando CSFloat Profit Finder..."

cd "$DIR"

if [ ! -d ".git" ]; then
    echo "Clonando repositorio..."
    git clone "$REPO" .
else
    echo "Actualizando desde GitHub..."
    git pull origin main
fi

echo ""
echo "Extension actualizada!"
echo ""
echo "Para aplicar cambios:"
echo "  Chrome: recarga la extension en chrome://extensions/"
echo "  Firefox: recarga el complemento en about:debugging"

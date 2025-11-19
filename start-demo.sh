#!/bin/bash

echo " Servidores:"
echo "   - JWT API: http://localhost:3001"
echo "   - Macaroons API: http://localhost:3002"
echo "   - Demo Web: http://localhost:3001 o http://localhost:3002"
echo ""
echo " Ctrl+C para detener"

npm run start:jwt & npm run start:macaroon & wait

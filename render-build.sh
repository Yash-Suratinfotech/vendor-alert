#!/usr/bin/env bash
# Exit on error
set -o errexit

# Install dependencies
npm install

# Build frontend
cd web/frontend
npm install
npm run build
cd ../..

# Initialize database
cd web
node db-table.js
cd ..
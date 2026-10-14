#!/usr/bin/env bash
# Print the password and current 6-digit login code for a seeded user.  Usage: bash scripts/login.sh safety1
set -euo pipefail
cd "$(dirname "$0")/../api"
node -e "
const {authenticator}=require('otplib');
const all=require('../seed/credentials.local.json');
const c=all.find(u=>u.username===process.argv[1]);
if(!c){console.error('unknown user; one of: '+all.map(u=>u.username).join(', '));process.exit(1);}
console.log('username: '+c.username+'\npassword: '+c.password+'\ncode:     '+authenticator.generate(c.totpSecret)+'  (valid ~30s)');
" "${1:?usage: bash scripts/login.sh <username>}"

#!/usr/bin/env bash
# Installs and starts the resolver as a systemd user service. Run from anywhere; undo with:
#   systemctl --user disable --now cardsdotgg-resolver && rm ~/.config/systemd/user/cardsdotgg-resolver.service
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo="$(cd "$here/../.." && pwd)"
node="$(readlink -f "$(command -v node)")"   # a stable path, not a version-manager shim
[ -f "$repo/.env.keeper" ] || { echo "missing $repo/.env.keeper (KEEPER_ACCOUNT_ID and KEEPER_PRIVATE_KEY)"; exit 1; }
[ -x "$repo/keeper/node_modules/.bin/tsx" ] || { echo "run pnpm install first"; exit 1; }
chmod 600 "$repo/.env.keeper"
dir="$HOME/.config/systemd/user"
mkdir -p "$dir"
sed -e "s#@REPO@#$repo#g" -e "s#@NODE@#$node#g" "$here/cardsdotgg-resolver.service" > "$dir/cardsdotgg-resolver.service"
systemctl --user daemon-reload
systemctl --user enable --now cardsdotgg-resolver
echo "installed. logs: journalctl --user -u cardsdotgg-resolver -f"
echo "to keep it running after you log out: sudo loginctl enable-linger $USER"

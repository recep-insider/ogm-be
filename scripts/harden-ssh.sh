#!/usr/bin/env bash
#
# OGM Gönüllü — SSH sertleştirme (sunucuda, root, ELLE çalıştırılır; deploy.sh çağırmaz)
#
# Kullanım:
#   sudo bash /opt/ogm-gonullu/scripts/harden-ssh.sh
#
# Script yaptıkları (tekrar çalıştırılabilir):
#   1. Çalıştıran kullanıcının ~/.ssh/authorized_keys'inde anahtar yoksa DURUR
#   2. fail2ban kurar, sshd jail'ini açar
#   3. Parola ve klavye-etkileşimli girişi drop-in ile kapatır
#   4. sshd -t + etkin değer (sshd -T) kontrolü geçmeden sshd'yi yeniden yüklemez
#
# DİKKAT: deploy.sh ve setup-domain.sh sshpass ile parola gönderiyor. Bundan sonra
# yalnızca yerel makinedeki anahtar (ssh-agent) sunucuda yetkiliyse bağlanırlar.

set -euo pipefail

DROPIN=/etc/ssh/sshd_config.d/00-ogm-hardening.conf
JAIL=/etc/fail2ban/jail.d/ogm-sshd.local

log()  { printf "\033[1;34m▶ %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✓ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
err()  { printf "\033[1;31m✗ %s\033[0m\n" "$*" >&2; }
die()  { err "$*"; exit 1; }

[ "$(id -u)" = 0 ] || die "root olarak çalıştırın: sudo bash $0"

# ─── Kilitlenme koruması ──────────────────────────────────────────────
USER_NAME="${SUDO_USER:-root}"
USER_HOME=$(getent passwd "$USER_NAME" | cut -d: -f6)
KEYS="$USER_HOME/.ssh/authorized_keys"
has_key() { grep -qE '^[^#[:space:]]' "$1" 2>/dev/null; }
has_key "$KEYS" || die "$KEYS boş ya da yok — parola kapanınca $USER_NAME giremez. Önce anahtar ekleyin (ssh-copy-id)."
ok "$USER_NAME için authorized_keys dolu"
if [ "$USER_NAME" != root ] && ! has_key /root/.ssh/authorized_keys; then
  warn "root için authorized_keys yok — deploy.sh (root@) bundan sonra bağlanamaz"
fi

# ─── fail2ban ──────────────────────────────────────────────
log "fail2ban kuruluyor"
if command -v apt-get >/dev/null; then
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq fail2ban python3-systemd
elif command -v dnf >/dev/null; then
  dnf install -y -q fail2ban || die "fail2ban kurulamadı (RHEL/Alma/Rocky'de önce: dnf install -y epel-release)"
else
  die "apt-get/dnf yok — fail2ban'ı elle kurun"
fi

# backend=systemd: Debian 12'de /var/log/auth.log yok, varsayılan backend ile jail açılmaz.
SSH_PORTS=$(sshd -T | awk '$1=="port"{print $2}' | paste -sd, -)
cat > "$JAIL" <<EOF
[sshd]
enabled  = true
backend  = systemd
port     = $SSH_PORTS
maxretry = 5
findtime = 10m
bantime  = 1h
EOF
systemctl enable fail2ban >/dev/null
systemctl restart fail2ban
for _ in $(seq 1 15); do fail2ban-client status sshd >/dev/null 2>&1 && break; sleep 1; done
fail2ban-client status sshd >/dev/null || die "fail2ban sshd jail'i açılmadı: journalctl -u fail2ban"
ok "fail2ban aktif (sshd jail, port $SSH_PORTS)"

# ─── sshd drop-in ──────────────────────────────────────────────
# sshd her ayar için İLK okuduğu değeri kullanır ve sshd_config.d'yi alfabetik okur;
# 00- öneki bulut imajlarının 50-cloud-init.conf'undaki "PasswordAuthentication yes"ten önce gelir.
log "sshd: parola girişi kapatılıyor ($DROPIN)"
cat > "$DROPIN" <<EOF
# scripts/harden-ssh.sh yazdı. Geri almak için: rm $DROPIN && sshd -t && systemctl reload ssh
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
chmod 644 "$DROPIN"

if ! sshd -t; then
  rm -f "$DROPIN"
  die "sshd -t başarısız — drop-in kaldırıldı, sshd yeniden yüklenmedi"
fi
EFFECTIVE=$(sshd -T)
for kv in 'passwordauthentication no' 'kbdinteractiveauthentication no'; do
  if ! grep -qx "$kv" <<<"$EFFECTIVE"; then
    rm -f "$DROPIN"
    die "Etkin ayar '$kv' değil (sshd_config'te Include'dan önce gelen bir satır ya da Include yok) — drop-in kaldırıldı, sshd yeniden yüklenmedi"
  fi
done

systemctl reload ssh 2>/dev/null || systemctl reload sshd \
  || die "sshd reload başarısız — drop-in yerinde, elle: systemctl reload ssh"
ok "sshd yeniden yüklendi (açık oturumlar etkilenmez)"

cat <<EOF

  ÖNEMLİ: Bu oturumu KAPATMADAN yeni bir terminalde anahtarla girişi deneyin:
    ssh -o PasswordAuthentication=no $USER_NAME@<sunucu>

  Geri alma:
    rm -f $DROPIN && sshd -t && (systemctl reload ssh || systemctl reload sshd)
    rm -f $JAIL && systemctl restart fail2ban    # tamamen: systemctl disable --now fail2ban
    fail2ban-client set sshd unbanip <IP>        # yanlışlıkla banlanan IP için

EOF

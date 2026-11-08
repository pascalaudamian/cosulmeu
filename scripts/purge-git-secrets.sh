#!/usr/bin/env bash
# ==============================================================================
# Coșul Meu — Script de eliminare permanentă a secretelor din istoricul Git
# Instrument: git-filter-repo (recomandat oficial de Git & GitHub)
# ==============================================================================
set -euo pipefail

echo "======================================================================"
echo "🧹 Coșul Meu: Curățare definitivă a istoricului Git cu git-filter-repo"
echo "======================================================================"

# 1. Verificare că suntem într-un repository git
if [ ! -d ".git" ]; then
  echo "❌ Eroare: Acest script trebuie rulat din rădăcina repository-ului Git local."
  echo "   Exemplu: cd /calea/catre/cosulmeu && bash scripts/purge-git-secrets.sh"
  exit 1
fi

# 2. Verificare / Instalare git-filter-repo
if ! command -v git-filter-repo &> /dev/null; then
  echo "⚠️ git-filter-repo nu este instalat în sistem."
  echo "📦 Se încearcă instalarea prin pip / python3..."
  python3 -m pip install --user git-filter-repo || pip install git-filter-repo
  export PATH="${HOME}/.local/bin:${PATH}"
fi

if ! command -v git-filter-repo &> /dev/null; then
  echo "❌ Eroare: git-filter-repo nu a putut fi instalat automat."
  echo "   Vă rugăm să instalați manual: pip install git-filter-repo sau brew install git-filter-repo"
  exit 1
fi

echo "✅ git-filter-repo este pregătit."

# 3. Salvare URL remote înainte de filtrare (git-filter-repo șterge automat remote-ul din motive de siguranță)
ORIGIN_URL=$(git remote get-url origin 2>/dev/null || echo "https://github.com/pascalaudamian/cosulmeu.git")
echo "ℹ️ Remote origin detectat: ${ORIGIN_URL}"

# 4. Creare backup local de siguranță înainte de rescrierea istoriei
BACKUP_BUNDLE="../cosulmeu-pre-filter-$(date +%Y%m%d%H%M%S).bundle"
echo "💾 Se creează backup de siguranță: ${BACKUP_BUNDLE}..."
git bundle create "${BACKUP_BUNDLE}" --all
echo "✅ Backup creat cu succes."

# 5. Creare fișier temporar de expresii de rescriere
# Format git-filter-repo --replace-text:
# text_vechi==>text_nou
EXPRESSIONS_FILE=$(mktemp)
cat << 'EOF' > "${EXPRESSIONS_FILE}"
# Parola bazei de date de producție Supabase
JmpyZ55DR5f0oIVq==>[REDACTED_POSTGRES_PASSWORD]

# URI-uri complete de conexiune PostgreSQL
postgres://postgres.bwanbgbimktluajvwzsj:JmpyZ55DR5f0oIVq@aws-0-eu-west-1.pooler.supabase.com:5432/postgres==>postgres://postgres:REDACTED@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
postgres://postgres.bwanbgbimktluajvwzsj:JmpyZ55DR5f0oIVq@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true==>postgres://postgres:REDACTED@aws-0-eu-west-1.pooler.supabase.com:6543/postgres?sslmode=require&pgbouncer=true
postgres://postgres.bwanbgbimktluajvwzsj:JmpyZ55DR5f0oIVq@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require&supa=base-pooler.x==>postgres://postgres:REDACTED@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require
postgres://postgres.bwanbgbimktluajvwzsj:JmpyZ55DR5f0oIVq@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require==>postgres://postgres:REDACTED@aws-0-eu-west-1.pooler.supabase.com:5432/postgres?sslmode=require
EOF

echo "🔍 Se rescrie întregul istoric Git (toate branch-urile, commit-urile și tag-urile)..."
git filter-repo --replace-text "${EXPRESSIONS_FILE}" --force
rm -f "${EXPRESSIONS_FILE}"

# 6. Re-atașare remote origin (git-filter-repo îl deconectează pentru prevenirea push-urilor accidentale)
echo "🔗 Re-configurare remote origin: ${ORIGIN_URL}..."
git remote add origin "${ORIGIN_URL}" || git remote set-url origin "${ORIGIN_URL}"

# 7. Curățare profundă cache și obiecte orfane locale
echo "🧹 Curățare reflog și garbage collection..."
git reflog expire --expire=now --all
git gc --prune=now --aggressive

# 8. Verificare că secretul a dispărut complet din repository
echo "🔎 Verificare că parola nu mai există în niciun commit sau blob..."
if git rev-list --all | xargs git grep -F "JmpyZ55DR5f0oIVq" 2>/dev/null; then
  echo "⚠️ ATENȚIE: S-au găsit încă apariții ale șirului sensibil."
else
  echo "✅ CONFIRMAT: Șirul sensibil a fost complet eliminat din tot istoricul Git local!"
fi

echo ""
echo "======================================================================"
echo "🚀 PASUL FINAL: Publicarea modificărilor pe GitHub"
echo "======================================================================"
echo "Executați următoarele comenzi pentru a suprascrie istoricul pe GitHub:"
echo ""
echo "    git push origin --force --all"
echo "    git push origin --force --tags"
echo ""
echo "⚠️  IMPORTANT DUPĂ PUSH:"
echo "1. În Supabase Dashboard -> Settings -> Database -> schimbați parola bazei de date (Reset password)."
echo "2. Actualizați variabilele de mediu în Vercel / Cloud Run / .env."
echo "3. Solicitați echipei de securitate/audit rescanarea (sau marcați alerta ca remediată)."
echo "======================================================================"

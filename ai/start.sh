cd "$(dirname "$0")"

if [ ! -d ".venv" ]; then
  echo "Criando ambiente virtual..."
  python -m venv .venv
fi

source .venv/Scripts/activate

if ! python -c "import fastapi" 2>/dev/null; then
  echo "Instalando dependencias..."
  pip install -r requirements.txt
fi

echo ""
echo "Servico de IA rodando em http://localhost:8000"
echo ""

PYTHONPATH="$(pwd)" .venv/Scripts/python.exe -m uvicorn src.main:app --port 8000

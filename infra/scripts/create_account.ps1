param(
  [Parameter(Mandatory = $true)]
  [string]$Email,
  [Parameter(Mandatory = $true)]
  [string]$Password,
  [string]$DisplayName = ""
)

$python = ".\.venv\Scripts\python.exe"
if (-not (Test-Path $python)) {
  throw "Python venv not found at .venv. Run: python -m venv .venv; .\.venv\Scripts\python.exe -m pip install -r requirements.txt"
}

& $python -m apps.api.create_account --email $Email --password $Password --display-name $DisplayName


# Bumps @version (patch) in every changed *.user.js, commits, and pushes.
# Tampermonkey only offers an update when @version goes UP, so never push an edit without bumping it.
# Usage:  .\publish.ps1 "what changed"
param([Parameter(Mandatory = $true)][string]$Message)

Set-Location $PSScriptRoot
$changed = @(git status --porcelain -- '*.user.js' | ForEach-Object { $_.Substring(3).Trim('"') })
if (-not $changed) { Write-Host 'No changed .user.js files.'; exit 0 }

foreach ($f in $changed) {
  $text = [IO.File]::ReadAllText("$PSScriptRoot\$f")
  $new = [regex]::Replace($text, '(//\s*@version\s+)(\d+)\.(\d+)\.(\d+)', {
      param($m) $m.Groups[1].Value + $m.Groups[2].Value + '.' + $m.Groups[3].Value + '.' + ([int]$m.Groups[4].Value + 1)
    }, 'IgnoreCase')
  if ($new -ne $text) { [IO.File]::WriteAllText("$PSScriptRoot\$f", $new, (New-Object Text.UTF8Encoding $false)) }
  Write-Host "Bumped $f"
}

git add -- $changed
git commit -m $Message
git push

param([string]$CMake = "")
$ErrorActionPreference = "Stop"
$root = Split-Path $PSScriptRoot -Parent
if (!$CMake) {
  $command = Get-Command cmake -ErrorAction SilentlyContinue
  if ($command) { $CMake = $command.Source }
  else {
    $CMake = Get-ChildItem "${env:ProgramFiles}/Microsoft Visual Studio/*/*/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe" | Select-Object -First 1 -ExpandProperty FullName
  }
}
if (!$CMake) { throw "Install Visual Studio with Desktop development with C++ and CMake." }
$source = Join-Path $root "refs/PotreeConverter"
$build = Join-Path $root "build/potree-converter"
& $CMake -S $source -B $build -A x64 "-DCMAKE_POLICY_VERSION_MINIMUM=3.5"
if ($LASTEXITCODE) { throw "CMake configure failed" }
& $CMake --build $build --config Release --parallel 12
if ($LASTEXITCODE) { throw "Build failed" }
Write-Output "Built executable and laszip.dll: $build/Release"
Write-Output "Validate the build before copying BOTH files into tools/PotreeConverter_2.1.5_x64_windows."

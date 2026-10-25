@echo off
setlocal
cd /d "%~dp0.."
set "CSC=%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
set "BUILD_OUTPUT=Launchers\0_Backend_Runner.build.exe"
set "UPDATED_OUTPUT=Launchers\0_Backend_Runner_Updated.exe"
if not exist "%CSC%" set "CSC=%WINDIR%\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
    echo Could not find the .NET Framework C# compiler.
    pause
    exit /b 1
)
"%CSC%" /nologo /target:winexe /out:"%BUILD_OUTPUT%" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Management.dll "tools\src\BackendRunner.cs"
if errorlevel 1 (
    if exist "%BUILD_OUTPUT%" del "%BUILD_OUTPUT%"
    echo Backend Runner build failed.
    pause
    exit /b 1
)
move /Y "%BUILD_OUTPUT%" "Launchers\0_Backend_Runner.exe" >nul
if errorlevel 1 (
    move /Y "%BUILD_OUTPUT%" "%UPDATED_OUTPUT%" >nul
    if errorlevel 1 (
        echo Could not install the updated Backend Runner executable.
        exit /b 1
    )
    echo The current Backend Runner is still open.
    echo Close it and launch Launchers\0_Backend_Runner_Updated.exe.
    exit /b 0
)
echo Built Launchers\0_Backend_Runner.exe

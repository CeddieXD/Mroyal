@echo off
setlocal
cd /d "%~dp0"
if not defined ANDROID_HOME if defined ANDROID_SDK_ROOT set "ANDROID_HOME=%ANDROID_SDK_ROOT%"
if not defined ANDROID_HOME if exist "%LOCALAPPDATA%\Android\Sdk\platforms\android-36\android.jar" set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined ANDROID_HOME (
    echo Android SDK not found. Set ANDROID_HOME or install Android SDK Platform 36.
    exit /b 1
)
call gradlew.bat assembleDebug
if errorlevel 1 exit /b 1
copy /Y "app\build\outputs\apk\debug\app-debug.apk" "..\Launchers\Mango_Royal_Connect.apk" >nul
if errorlevel 1 (
    echo Could not copy the APK to Launchers.
    exit /b 1
)
echo Created ..\Launchers\Mango_Royal_Connect.apk

# Run this script after closing Cursor, Metro, and any terminals using the project.
# Execute from D:\ReactNative
Set-Location D:\ReactNative

# Remove old wa-audio if it exists (required before renaming)
if (Test-Path "wa-audio") {
    Write-Host "Removing existing wa-audio (this may take a few minutes)..."
    Remove-Item -Path "wa-audio" -Recurse -Force
    if (Test-Path "wa-audio") { Write-Host "ERROR: Could not remove wa-audio. Close all apps and try again."; exit 1 }
}

# Rename ExampleApp to example (inside react-native-whatsapp-audio-recorder)
if (Test-Path "react-native-whatsapp-audio-recorder\ExampleApp") {
    Write-Host "Renaming ExampleApp to example..."
    Rename-Item -Path "react-native-whatsapp-audio-recorder\ExampleApp" -NewName "example"
}

# Rename root folder to wa-audio
if (Test-Path "react-native-whatsapp-audio-recorder") {
    Write-Host "Renaming react-native-whatsapp-audio-recorder to wa-audio..."
    Rename-Item -Path "react-native-whatsapp-audio-recorder" -NewName "wa-audio"
}

Write-Host "Done. New path: D:\ReactNative\wa-audio\example"

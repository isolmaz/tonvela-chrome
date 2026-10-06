$ErrorActionPreference = 'Stop'
$fixtureDirectory = Join-Path (Split-Path $PSScriptRoot -Parent) '.cache'
New-Item -ItemType Directory -Path $fixtureDirectory -Force | Out-Null
Add-Type -AssemblyName System.Speech
$fixtureVoice = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    $fixtureVoice.SetOutputToWaveFile((Join-Path $fixtureDirectory 'test-speech.wav'))
    $fixtureVoice.Speak('This is a local audio test. The volume should stay comfortable when the speaker becomes quieter or louder. Background sound should be reduced while the words remain clear.')
} finally {
    $fixtureVoice.Dispose()
}

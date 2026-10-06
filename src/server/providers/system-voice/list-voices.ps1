# Motion Studio — lists enabled Windows system (SAPI) voices as JSON on stdout.
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Speech
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
$voices = @($synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
  [pscustomobject]@{ name = $_.VoiceInfo.Name; culture = $_.VoiceInfo.Culture.Name; gender = $_.VoiceInfo.Gender.ToString() }
})
$synth.Dispose()
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
[Console]::Out.Write((ConvertTo-Json -InputObject $voices -Compress))

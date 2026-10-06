param(
  [Parameter(Mandatory = $true)][string]$Request
)
# Motion Studio — Windows system voice (SAPI) synthesis.
# Reads a JSON request file (text, voiceName, rate, outputPath, resultPath) so no user text is
# ever passed on a command line. Writes a 44.1 kHz mono WAV and word boundary marks.
$ErrorActionPreference = "Stop"
$req = Get-Content -LiteralPath $Request -Raw -Encoding UTF8 | ConvertFrom-Json

$speech = [System.Reflection.Assembly]::LoadWithPartialName("System.Speech")
$code = @"
using System;
using System.Globalization;
using System.Text;
using System.Speech.AudioFormat;
using System.Speech.Synthesis;

public static class MotionStudioSapi {
  static string Esc(string s) {
    var sb = new StringBuilder("\"");
    foreach (var c in s) {
      switch (c) {
        case '\\': sb.Append("\\\\"); break;
        case '"': sb.Append("\\\""); break;
        case '\n': sb.Append("\\n"); break;
        case '\r': sb.Append("\\r"); break;
        case '\t': sb.Append("\\t"); break;
        default:
          if (c < 32) sb.Append("\\u" + ((int)c).ToString("x4")); else sb.Append(c);
          break;
      }
    }
    return sb.Append('"').ToString();
  }

  public static string Run(string text, string wavPath, string voiceName, int rate) {
    var marks = new StringBuilder("[");
    var first = true;
    string usedVoice = "";
    using (var synth = new SpeechSynthesizer()) {
      if (!string.IsNullOrEmpty(voiceName)) synth.SelectVoice(voiceName);
      usedVoice = synth.Voice.Name;
      synth.Rate = Math.Max(-10, Math.Min(10, rate));
      // Keep the engine's native format: SpeakProgress AudioPosition is reported in that format,
      // so forcing another sample rate makes word positions drift from the rendered audio.
      synth.SetOutputToWaveFile(wavPath);
      synth.SpeakProgress += (s, e) => {
        if (!first) marks.Append(",");
        first = false;
        marks.Append("{\"audioMs\":" + e.AudioPosition.TotalMilliseconds.ToString(CultureInfo.InvariantCulture)
          + ",\"charPos\":" + e.CharacterPosition
          + ",\"charCount\":" + e.CharacterCount
          + ",\"text\":" + Esc(e.Text ?? "") + "}");
      };
      synth.Speak(text);
    }
    marks.Append("]");
    return "{\"voice\":" + Esc(usedVoice) + ",\"marks\":" + marks.ToString() + "}";
  }
}
"@
Add-Type -TypeDefinition $code -ReferencedAssemblies $speech.Location
$json = [MotionStudioSapi]::Run([string]$req.text, [string]$req.outputPath, [string]$req.voiceName, [int]$req.rate)
[System.IO.File]::WriteAllText([string]$req.resultPath, $json, (New-Object System.Text.UTF8Encoding $false))

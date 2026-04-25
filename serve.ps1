# Simple local HTTP server — no Node.js or Python required.
# Run from this directory:  .\serve.ps1
# Then open:  http://localhost:8080

$port = 8080
$root = $PSScriptRoot

$mimeTypes = @{
    ".html" = "text/html; charset=utf-8"
    ".js"   = "application/javascript"
    ".mjs"  = "application/javascript"
    ".css"  = "text/css"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Start()

Write-Host ""
Write-Host "  ArcGIS AI Map Assistant"
Write-Host "  Listening at: http://localhost:$port/"
Write-Host "  Press Ctrl+C to stop."
Write-Host ""

try {
    while ($listener.IsListening) {
        $ctx  = $listener.GetContext()
        $req  = $ctx.Request
        $resp = $ctx.Response

        $localPath = $req.Url.LocalPath
        if ($localPath -eq "/") { $localPath = "/index.html" }

        $fullPath = Join-Path $root $localPath.TrimStart("/")

        if (Test-Path $fullPath -PathType Leaf) {
            $ext  = [System.IO.Path]::GetExtension($fullPath).ToLower()
            $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
            $bytes = [System.IO.File]::ReadAllBytes($fullPath)

            $resp.ContentType      = $mime
            $resp.ContentLength64  = $bytes.Length
            $resp.StatusCode       = 200
            $resp.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $resp.StatusCode = 404
            $msg  = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $localPath")
            $resp.ContentLength64 = $msg.Length
            $resp.OutputStream.Write($msg, 0, $msg.Length)
        }

        $resp.Close()
        Write-Host "  $($req.HttpMethod) $($req.Url.PathAndQuery) -> $($resp.StatusCode)"
    }
} finally {
    $listener.Stop()
}

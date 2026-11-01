Add-Type -Namespace ChenMeng -Name Window -MemberDefinition '[System.Runtime.InteropServices.DllImport("user32.dll", CharSet=System.Runtime.InteropServices.CharSet.Unicode)] public static extern bool SetWindowText(IntPtr hWnd,string text);'
while ($game = Get-Process -Id $env:CM_GAME_PID -ErrorAction SilentlyContinue) {
    if ($game.MainWindowHandle -ne 0 -and $game.MainWindowTitle -ne $env:CM_GAME_TITLE) {
        [void][ChenMeng.Window]::SetWindowText($game.MainWindowHandle,$env:CM_GAME_TITLE)
    }
    Start-Sleep -Seconds 2
}

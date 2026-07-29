Option Explicit

Dim arguments
Dim configPath
Dim fileSystem
Dim nodeExecutable
Dim scriptDirectory
Dim scriptsDirectory
Dim shell
Dim command
Dim exitCode
Dim watchdogPath

Set arguments = WScript.Arguments
If arguments.Count < 1 Or arguments.Count > 2 Then
  WScript.Quit 64
End If

configPath = arguments.Item(0)
If arguments.Count = 2 Then
  nodeExecutable = arguments.Item(1)
Else
  nodeExecutable = "node.exe"
End If

Set fileSystem = CreateObject("Scripting.FileSystemObject")
scriptDirectory = fileSystem.GetParentFolderName(WScript.ScriptFullName)
scriptsDirectory = fileSystem.GetParentFolderName(scriptDirectory)
watchdogPath = fileSystem.BuildPath(scriptsDirectory, "codex-peer-watchdog.mjs")

If Not fileSystem.FileExists(watchdogPath) Then
  WScript.Quit 66
End If

If Not fileSystem.FileExists(configPath) Then
  WScript.Quit 66
End If

command = QuoteArgument(nodeExecutable) & " " & _
  QuoteArgument(watchdogPath) & " --config " & QuoteArgument(configPath)

Set shell = CreateObject("WScript.Shell")
exitCode = shell.Run(command, 0, True)
WScript.Quit exitCode

Function QuoteArgument(value)
  QuoteArgument = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function

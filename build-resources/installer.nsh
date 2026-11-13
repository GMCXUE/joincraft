; Keep the application in a per-user writable location for in-app directory updates.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

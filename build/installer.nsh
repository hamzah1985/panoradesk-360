!macro customInstall
  ; Clean up legacy shortcut names left from older builds.
  Delete "$DESKTOP\PanoraDesk360.lnk"
  Delete "$SMPROGRAMS\PanoraDesk360.lnk"
  Delete "$DESKTOP\PanoraDesk 360.lnk"
  Delete "$SMPROGRAMS\PanoraDesk 360.lnk"

  ; Refresh canonical shortcuts to the current executable.
  CreateShortCut "$DESKTOP\PanoraDesk 360.lnk" "$INSTDIR\PanoraDesk360.exe"
  CreateShortCut "$SMPROGRAMS\PanoraDesk 360.lnk" "$INSTDIR\PanoraDesk360.exe"
!macroend

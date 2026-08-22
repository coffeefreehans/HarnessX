/** Custom NSIS finish page: launch the app reliably after installation. */
!macro customFinishPage
  Function StartAppReliable
    ${if} ${UAC_IsAdmin}
      # StdUtils.ExecShellAsUser silently fails on Administrator accounts with
      # UAC disabled; a direct exec is the only reliable launch when elevated.
      Exec '"$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
    ${else}
      ExecShell "open" "$launchLink"
    ${endif}
  FunctionEnd

  !define MUI_FINISHPAGE_RUN
  !define MUI_FINISHPAGE_RUN_FUNCTION "StartAppReliable"
  !insertmacro MUI_PAGE_FINISH
!macroend

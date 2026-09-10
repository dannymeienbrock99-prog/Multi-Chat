!ifndef BUILD_UNINSTALLER
  !include "LogicLib.nsh"
  !include "nsDialogs.nsh"
  !include "WinMessages.nsh"
  !include "generated-installer-key.nsh"

  Var BattoKeyDialog
  Var BattoKeyField
  Var BattoKeyStatus
  Var BattoKeyInput
  Var BattoKeyNormalized
  Var BattoKeyValid
  Var BattoLicenseConsent

  !macro customWelcomePage
    !insertmacro MUI_PAGE_WELCOME
  !macroend

  !macro customPageAfterChangeDir
    Page custom BattoKeyPageCreate BattoKeyPageLeave
  !macroend

  !macro customInit
    ${If} ${Silent}
      ReadEnvStr $BattoLicenseConsent "BATTO_ACCEPT_LICENSE"
      ReadEnvStr $BattoKeyInput "BATTO_INSTALL_KEY"
      StrCmp $BattoLicenseConsent "YES" 0 BattoSilentDenied
      Call BattoVerifyInstallKey
      StrCmp $BattoKeyValid "1" BattoSilentAccepted BattoSilentDenied

      BattoSilentDenied:
        StrCpy $BattoKeyInput ""
        StrCpy $BattoLicenseConsent ""
        SetErrorLevel 1603
        Quit

      BattoSilentAccepted:
        StrCpy $BattoKeyInput ""
        StrCpy $BattoLicenseConsent ""
    ${EndIf}
  !macroend

  !macro customHeader
  Function BattoKeyPageCreate
    !insertmacro MUI_HEADER_TEXT "Installationsschlüssel" "Batto OBS Tool ist durch einen privaten Installationsschlüssel geschützt."
    nsDialogs::Create 1018
    Pop $BattoKeyDialog
    ${If} $BattoKeyDialog == error
      Abort
    ${EndIf}

    ${NSD_CreateLabel} 0 2u 100% 24u "Bitte den von Crazy_Batto / Team Alpha erhaltenen Installationsschlüssel eingeben. Leerzeichen und Bindestriche werden automatisch berücksichtigt."
    Pop $0
    ${NSD_CreatePassword} 0 34u 100% 14u ""
    Pop $BattoKeyField
    SendMessage $BattoKeyField ${EM_SETLIMITTEXT} 96 0
    ${NSD_CreateLabel} 0 56u 100% 22u "Der Schlüssel wird nur lokal geprüft und nicht auf dem Computer gespeichert."
    Pop $0
    ${NSD_CreateLabel} 0 82u 100% 18u ""
    Pop $BattoKeyStatus
    SetCtlColors $BattoKeyStatus 0xD32F2F transparent
    ${NSD_SetFocus} $BattoKeyField
    nsDialogs::Show
  FunctionEnd

  Function BattoKeyPageLeave
    ${NSD_GetText} $BattoKeyField $BattoKeyInput
    Call BattoVerifyInstallKey
    ${If} $BattoKeyValid != "1"
      ${NSD_SetText} $BattoKeyStatus "Der Installationsschlüssel ist leer oder ungültig. Bitte erneut eingeben."
      ${NSD_SetText} $BattoKeyField ""
      ${NSD_SetFocus} $BattoKeyField
      Abort
    ${EndIf}
    ${NSD_SetText} $BattoKeyField ""
  FunctionEnd

  Function BattoVerifyInstallKey
    Push $R0
    Push $R1
    Push $R2
    Push $R3
    StrCpy $BattoKeyValid "0"
    StrCpy $BattoKeyNormalized ""
    StrCpy $R0 0

    BattoNormalizeNext:
      StrCpy $R1 $BattoKeyInput 1 $R0
      StrCmp $R1 "" BattoNormalizeDone
      IntOp $R0 $R0 + 1
      StrCmp $R1 " " BattoNormalizeNext
      StrCmp $R1 "$\t" BattoNormalizeNext
      StrCmp $R1 "$\r" BattoNormalizeNext
      StrCmp $R1 "$\n" BattoNormalizeNext
      StrCmp $R1 " " BattoNormalizeNext
      StrCmp $R1 "-" BattoNormalizeNext
      StrCmp $R1 "‐" BattoNormalizeNext
      StrCmp $R1 "‑" BattoNormalizeNext
      StrCmp $R1 "‒" BattoNormalizeNext
      StrCmp $R1 "–" BattoNormalizeNext
      StrCmp $R1 "—" BattoNormalizeNext
      StrCmp $R1 "―" BattoNormalizeNext
      StrCmp $R1 "0" BattoNormalizeAppend
      StrCmp $R1 "1" BattoNormalizeAppend
      StrCmp $R1 "2" BattoNormalizeAppend
      StrCmp $R1 "3" BattoNormalizeAppend
      StrCmp $R1 "4" BattoNormalizeAppend
      StrCmp $R1 "5" BattoNormalizeAppend
      StrCmp $R1 "6" BattoNormalizeAppend
      StrCmp $R1 "7" BattoNormalizeAppend
      StrCmp $R1 "8" BattoNormalizeAppend
      StrCmp $R1 "9" BattoNormalizeAppend BattoVerifyCleanup

    BattoNormalizeAppend:
      StrCpy $BattoKeyNormalized "$BattoKeyNormalized$R1"
      Goto BattoNormalizeNext

    BattoNormalizeDone:
      StrLen $R2 $BattoKeyNormalized
      IntCmp $R2 ${BATTO_INSTALL_KEY_LENGTH} BattoHashBegin BattoVerifyCleanup BattoVerifyCleanup

    BattoHashBegin:
      StrCpy $R2 "${BATTO_INSTALL_KEY_SALT}:$BattoKeyNormalized"
      StrCpy $R3 0

    BattoHashNext:
      IntCmp $R3 ${BATTO_INSTALL_KEY_ITERATIONS} BattoHashDone BattoHashStep BattoHashDone

    BattoHashStep:
      ${StdUtils.HashText} $R2 "${BATTO_INSTALL_KEY_ALGORITHM}" "$R2"
      IntOp $R3 $R3 + 1
      Goto BattoHashNext

    BattoHashDone:
      StrCmp $R2 "${BATTO_INSTALL_KEY_DIGEST}" 0 BattoVerifyCleanup
      StrCpy $BattoKeyValid "1"

    BattoVerifyCleanup:
      StrCpy $BattoKeyInput ""
      StrCpy $BattoKeyNormalized ""
      StrCpy $R0 ""
      StrCpy $R1 ""
      StrCpy $R2 ""
      StrCpy $R3 ""
      Pop $R3
      Pop $R2
      Pop $R1
      Pop $R0
  FunctionEnd
  !macroend
!endif

/**
 * The terminal's own notification, for when a ship outlives the user's
 * attention.
 *
 * `ctx.ui.notify` writes into the transcript, which only helps someone still
 * looking at it. A ship runs checks, waits on a model for the message, and
 * pushes over the network, so the user is usually in another window by the time
 * it lands. This is the same escape sequence pi's own `notify.ts` example uses
 * on `agent_settled`, so a finished ship raises the same OS notification an
 * agent turn does.
 *
 * Three protocols because terminals never agreed on one: OSC 777 is the common
 * case (Ghostty, iTerm2, WezTerm), Kitty speaks OSC 99, and Windows Terminal
 * has no sequence at all so it gets a PowerShell toast.
 *
 * Only ever called in TUI mode. The sequence goes to stdout, and in RPC mode
 * stdout is the JSON protocol, so writing there corrupts the stream Paseo is
 * reading rather than raising anything.
 *
 * No pi runtime behind it, same as `ship-notice.ts`, so it unit-tests on its
 * own.
 */

import { execFile } from "node:child_process";

/** What pi's own notification says, so a shipped run reads like any other. */
export const DEFAULT_ALERT = { title: "Pi", body: "Ready for input" } as const;

function windowsToastScript(title: string, body: string): string {
  const type = "Windows.UI.Notifications";
  const mgr = `[${type}.ToastNotificationManager, ${type}, ContentType = WindowsRuntime]`;
  const template = `[${type}.ToastTemplateType]::ToastText01`;
  const toast = `[${type}.ToastNotification]::new($xml)`;
  return [
    `${mgr} > $null`,
    `$xml = [${type}.ToastNotificationManager]::GetTemplateContent(${template})`,
    `$xml.GetElementsByTagName('text')[0].AppendChild($xml.CreateTextNode('${body}')) > $null`,
    `[${type}.ToastNotificationManager]::CreateToastNotifier('${title}').Show(${toast})`,
  ].join("; ");
}

/**
 * Raises the terminal's notification. Never throws: a notification that fails
 * is not a reason to fail a push that already succeeded.
 */
export function alert(
  { title, body } = DEFAULT_ALERT,
  write: (text: string) => void = (text) => void process.stdout.write(text),
): void {
  try {
    if (process.env.WT_SESSION) {
      execFile("powershell.exe", [
        "-NoProfile",
        "-Command",
        windowsToastScript(title, body),
      ]);
      return;
    }
    if (process.env.KITTY_WINDOW_ID) {
      // i=notification id, d=0 means more to come, p=body names the second part.
      write(`\x1b]99;i=1:d=0;${title}\x1b\\`);
      write(`\x1b]99;i=1:p=body;${body}\x1b\\`);
      return;
    }
    write(`\x1b]777;notify;${title};${body}\x07`);
  } catch {
    // Notifying is best-effort by definition.
  }
}

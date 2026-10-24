import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
test('native docking follows its owner, restores floating bounds, waits for a new owner and releases maximized space', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-dock-'));
  try {
    const driver = path.join(dir, 'dock.cs'), exe = path.join(dir, 'dock.exe');
    fs.writeFileSync(driver, `
using System;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Windows.Forms;
class QuietForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class Driver {
  [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hwnd, int cmd);
  static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
  static void Beside(Form panel, Form owner) {
    Check(panel.Left == owner.Right || panel.Right == owner.Left, "panel must touch the owner edge");
    Check(panel.Top == owner.Top && panel.Height == owner.Height, "panel follows owner height and top");
  }
  [STAThread] static void Main() {
    var area = Screen.PrimaryScreen.WorkingArea;
    var external = new Rectangle(-1920, -200, 1920, 1080);
    var large = new Rectangle(-1920, -200, 1920, 1080);
    Check(PanelDock.MakeRoom(large, external, 460) == new Rectangle(-1920, -200, 1460, 1080), "negative monitor coordinates");
    Check(PanelDock.PanelBounds(new Rectangle(1400, 50, 500, 800), new Rectangle(0, 0, 1920, 1080), 460).X == 940, "left docking when right has no space");
    using (var owner = new QuietForm()) using (var panel = new QuietForm()) {
      owner.Opacity = panel.Opacity = 0; owner.ShowInTaskbar = panel.ShowInTaskbar = false;
      owner.StartPosition = panel.StartPosition = FormStartPosition.Manual;
      owner.Bounds = new Rectangle(area.Left + 40, area.Top + 40, 640, 600);
      panel.Bounds = new Rectangle(area.Left + 120, area.Top + 100, 400, 550);
      panel.MinimumSize = new Size(370, 200);
      owner.Show(); panel.Show(); Application.DoEvents();
      var floating = panel.Bounds;
      using (var dock = new PanelDock(panel, () => {})) {
        dock.SetEnabled(true); Check(dock.Enabled && !dock.Attached, "preference waits without a target");
        dock.SetTarget(owner.Handle); dock.Sync(); Check(dock.Attached, "attaches to the supplied target"); Beside(panel, owner);
        owner.Top += 25; owner.Height -= 25; dock.Sync(); Beside(panel, owner);
        ShowWindow(owner.Handle, 6); Application.DoEvents(); dock.Sync(); Check(!panel.Visible, "minimizing owner hides attached panel");
        dock.ActivateOwner(); Application.DoEvents(); dock.Sync(); Check(panel.Visible, "activation restores the minimized owner and panel"); Beside(panel, owner);
        dock.SetEnabled(false); Check(!dock.Attached && panel.Bounds == floating, "detaching restores floating placement");
        owner.Bounds = area; Application.DoEvents(); var original = owner.Bounds;
        dock.SetEnabled(true); dock.Sync(); Check(dock.Attached, "full width target attaches"); Beside(panel, owner);
        Check(owner.Width < original.Width, "docking makes room for panel");
        dock.SetEnabled(false); Application.DoEvents(); Check(owner.Bounds == original, "detaching restores unmodified owner placement");
        dock.SetEnabled(true); dock.SetTarget(IntPtr.Zero); Check(dock.Enabled && !dock.Attached && panel.Bounds == floating, "disconnect floats panel while remembering preference");
        dock.SetTarget(owner.Handle); Check(dock.Attached, "reattaches after reconnect");
        owner.Close(); Application.DoEvents(); dock.Sync(); Check(dock.Enabled && !dock.Attached && panel.Visible, "owner exit keeps the chat panel available");
        dock.SetEnabled(false);
      }
      panel.Close();
    }
    Console.WriteLine("native docking lifecycle passed");
  }
}`);
    const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await run(compiler, ['/nologo', '/target:exe', '/out:' + exe, '/reference:System.Drawing.dll', '/reference:System.Windows.Forms.dll', driver, path.join(root, 'desktop/PanelDock.cs')], { windowsHide: true });
    const result = await run(exe, [], { windowsHide: true, timeout: 15000 });
    assert.match(result.stdout, /native docking lifecycle passed/);
  } finally {
    await fs.promises.rm(dir, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
  }
});

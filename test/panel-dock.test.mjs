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
test('a cross-process pane survives graceful owner exit and owner crash', { skip: process.platform !== 'win32' }, async () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pobai-dock-process-'));
  try {
    const driver=path.join(dir,'process.cs'), exe=path.join(dir,'process.exe');
    fs.writeFileSync(driver, `
using System; using System.Diagnostics; using System.Drawing; using System.IO; using System.Runtime.InteropServices; using System.Windows.Forms;
class Quiet : Form {
  internal PanelDock Dock;
  protected override bool ShowWithoutActivation { get { return true; } }
  protected override void WndProc(ref Message m) { if(Dock!=null && m.Msg==PanelDock.ReleaseMessage) { Dock.ReleaseTarget(); return; } base.WndProc(ref m); }
}
class Driver {
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern bool SetPropW(IntPtr h,string s,IntPtr v);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr RemovePropW(IntPtr h,string s);
  [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern IntPtr GetPropW(IntPtr h,string s);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h,uint m,IntPtr w,IntPtr l);
  static void Check(bool v,string m) { if(!v) throw new Exception(m); }
  [STAThread] static void Main(string[] args) {
    string state=Path.Combine(Path.GetDirectoryName(Application.ExecutablePath),"owner.txt");
    if(args.Length>0) {
      using(var owner=new Quiet()) {
        owner.Opacity=0; owner.ShowInTaskbar=false; owner.Bounds=new Rectangle(20,20,1300,800);
        owner.Shown+=(s,e)=>{ SetPropW(owner.Handle,PanelDock.HostProperty,new IntPtr(36)); File.WriteAllText(state,owner.Handle.ToInt64().ToString()); };
        var t=new Timer{Interval=20}; t.Tick+=(s,e)=>{ if(!File.Exists(state+".close")) return;
          RemovePropW(owner.Handle,PanelDock.HostProperty); var child=GetPropW(owner.Handle,PanelDock.PaneProperty);
          if(child!=IntPtr.Zero) SendMessage(child,PanelDock.ReleaseMessage,IntPtr.Zero,IntPtr.Zero); owner.Close(); };
        t.Start(); Application.Run(owner); t.Dispose();
      } return;
    }
    foreach(bool crash in new[]{false,true}) {
      File.Delete(state); File.Delete(state+".close");
      using(var owner=Process.Start(new ProcessStartInfo(Application.ExecutablePath,"owner"){UseShellExecute=false,CreateNoWindow=true}))
      using(var panel=new Quiet()) {
        var until=DateTime.UtcNow.AddSeconds(5); while(!File.Exists(state) && DateTime.UtcNow<until) System.Threading.Thread.Sleep(10);
        panel.Opacity=0;panel.ShowInTaskbar=false; panel.Bounds=new Rectangle(100,100,400,550); panel.Show();
        using(var dock=new PanelDock(panel,()=>{})) {
          panel.Dock=dock; dock.SetTarget(new IntPtr(long.Parse(File.ReadAllText(state)))); dock.SetEnabled(true);
          Check(dock.Attached,"cross-process attachment");
          if(crash) owner.Kill(); else File.WriteAllText(state+".close","");
          until=DateTime.UtcNow.AddSeconds(5); while(!owner.HasExited && DateTime.UtcNow<until) { Application.DoEvents(); System.Threading.Thread.Sleep(10); }
          Check(owner.HasExited,"fixture owner exited"); Application.DoEvents(); dock.Sync();
          Check(!panel.IsDisposed && panel.IsHandleCreated,"owner exit must not destroy chat HWND (crash="+crash+")");
          Check(!dock.Attached && panel.Visible,"chat floats after owner exit");
        } panel.Close();
      }
    } Console.WriteLine("cross-process exit passed");
  }
}`);
    const compiler=path.join(process.env.SystemRoot||'C:/Windows','Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await run(compiler,['/nologo','/target:exe','/out:'+exe,'/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',driver,path.join(root,'desktop/PanelDock.cs')],{windowsHide:true});
    assert.match((await run(exe,[],{windowsHide:true,timeout:15000})).stdout,/cross-process exit passed/);
  } finally { await fs.promises.rm(dir,{recursive:true,force:true,maxRetries:20,retryDelay:50}); }
});
test('attached chat is a child pane inside the unchanged PoB client frame', { skip: process.platform !== 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pobai-integrated-dock-'));
  try {
    const driver = path.join(dir, 'integrated.cs'), exe = path.join(dir, 'integrated.exe');
    fs.writeFileSync(driver, `
using System; using System.Drawing; using System.Runtime.InteropServices; using System.Windows.Forms;
class QuietForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class Driver {
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetPropW(IntPtr hwnd,string name,IntPtr value);
  static void Check(bool value, string why) { if (!value) throw new Exception(why); }
  [STAThread] static void Main() {
    using (var owner = new QuietForm()) using (var panel = new QuietForm()) {
      owner.Opacity = panel.Opacity = 0; owner.ShowInTaskbar = panel.ShowInTaskbar = false;
      owner.StartPosition = panel.StartPosition = FormStartPosition.Manual;
      owner.Bounds = new Rectangle(40,40,1200,800); panel.Bounds = new Rectangle(160,160,400,600);
      panel.MinimumSize = new Size(370,200); owner.Show(); panel.Show(); Application.DoEvents();
      var originalOwner=owner.Bounds; var floating=panel.Bounds;
      SetPropW(owner.Handle, "PoBAI.DockHost.v1", new IntPtr(36));
      using(var dock = new PanelDock(panel,()=>{})) {
        dock.SetTarget(owner.Handle); dock.SetEnabled(true); dock.Sync();
        Check(dock.Attached, "attach the supplied owner");
        Check(GetParent(panel.Handle)==owner.Handle, "docked chat must be a child pane, not a second top-level window beside PoB");
        Check(owner.Bounds==originalOwner, "attaching must keep the outer PoB frame unchanged");
        RECT r; GetWindowRect(panel.Handle,out r); var at=owner.PointToClient(new Point(r.L,r.T));
        Check(at.X+panel.Width==owner.ClientSize.Width && at.Y+panel.Height==owner.ClientSize.Height, "pane meets the inside right and bottom edges");
        dock.SetEnabled(false);
        Check(GetParent(panel.Handle)==IntPtr.Zero && panel.Bounds==floating, "detach restores the independent window and its placement");
      }
      panel.Close(); owner.Close();
    }
    Console.WriteLine("integrated child pane passed");
  }
}`);
    const compiler = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe');
    await run(compiler, ['/nologo','/target:exe','/out:'+exe,'/reference:System.Drawing.dll','/reference:System.Windows.Forms.dll',driver,path.join(root,'desktop/PanelDock.cs')], { windowsHide:true });
    assert.match((await run(exe, [], { windowsHide:true,timeout:15000 })).stdout,/integrated child pane passed/);
  } finally {
    await fs.promises.rm(dir, {recursive:true,force:true,maxRetries:20,retryDelay:50});
  }
});
test('native child docking reserves space, follows resizing, restores floating bounds and waits for a compatible owner', { skip: process.platform !== 'win32' }, async () => {
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
  [DllImport("user32.dll")] static extern IntPtr GetParent(IntPtr hwnd);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
  [StructLayout(LayoutKind.Sequential)] struct RECT { public int L,T,R,B; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern bool SetPropW(IntPtr hwnd,string name,IntPtr value);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr GetPropW(IntPtr hwnd,string name);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr RemovePropW(IntPtr hwnd,string name);
  static void Check(bool condition, string message) { if (!condition) throw new Exception(message); }
  static void Inside(Form panel, Form owner) {
    Check(GetParent(panel.Handle) == owner.Handle, "pane is a real child");
    RECT r; GetWindowRect(panel.Handle,out r); var at=owner.PointToClient(new Point(r.L,r.T));
    Check(at.X + panel.Width == owner.ClientSize.Width && at.Y + panel.Height == owner.ClientSize.Height && at.Y == 36, "pane fills reserved client region below the caption");
    Check(GetPropW(owner.Handle, "PoBAI.DockWidth.v1").ToInt32() == panel.Width, "viewport reservation matches pane");
  }
  [STAThread] static void Main() {
    var area = Screen.PrimaryScreen.WorkingArea;
    using (var owner = new QuietForm()) using (var panel = new QuietForm()) {
      owner.Opacity = panel.Opacity = 0; owner.ShowInTaskbar = panel.ShowInTaskbar = false;
      owner.StartPosition = panel.StartPosition = FormStartPosition.Manual;
      owner.Bounds = new Rectangle(area.Left + 40, area.Top + 40, 1300, 800);
      panel.Bounds = new Rectangle(area.Left + 120, area.Top + 100, 400, 550);
      panel.MinimumSize = new Size(370, 200);
      owner.Show(); panel.Show(); Application.DoEvents();
      var floating = panel.Bounds;
      using (var dock = new PanelDock(panel, () => {})) {
        dock.SetEnabled(true); Check(dock.Enabled && !dock.Attached, "preference waits without a target");
        dock.SetTarget(owner.Handle); dock.Sync(); Check(!dock.Attached, "old adapter waits without covering PoB");
        SetPropW(owner.Handle, "PoBAI.DockHost.v1", new IntPtr(36));
        dock.Sync(); Check(dock.Attached, "attaches to compatible target"); Inside(panel, owner);
        owner.Top -= 200; owner.Left -= 250; owner.Height -= 25; dock.Sync(); Inside(panel, owner);
        ShowWindow(owner.Handle, 6); Application.DoEvents(); dock.Sync();
        dock.ActivateOwner(); Application.DoEvents(); dock.Sync(); Check(panel.Visible, "activation restores the minimized owner and panel"); Inside(panel, owner);
        dock.SetEnabled(false); Check(!dock.Attached && panel.Bounds == floating, "detaching restores floating placement");
        owner.Bounds = area; Application.DoEvents(); var original = owner.Bounds;
        dock.SetEnabled(true); dock.Sync(); Check(dock.Attached, "full width target attaches"); Inside(panel, owner);
        Check(owner.Bounds == original, "outer frame stays unchanged");
        dock.Width=460; dock.Sync(); Check(panel.Width==460, "splitter can change pane width");
        dock.SetEnabled(false); Application.DoEvents(); Check(owner.Bounds == original, "detaching restores unmodified owner placement");
        dock.SetEnabled(true); dock.SetTarget(IntPtr.Zero); Check(dock.Enabled && !dock.Attached && panel.Bounds == floating, "disconnect floats panel while remembering preference");
        dock.SetTarget(owner.Handle); Check(dock.Attached, "reattaches after reconnect");
        RemovePropW(owner.Handle, "PoBAI.DockHost.v1"); dock.ReleaseTarget();
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

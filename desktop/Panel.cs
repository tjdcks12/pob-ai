using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

// A separate Edge WebView2 window for the existing local agent panel. Only the window
// shell lives here; agents, history and PoB commands stay in the authenticated service.
internal sealed class AgentWindow : Form
{
    private readonly WebView2 web = new WebView2();
    private readonly Uri origin;
    private readonly string profile, snapshot, verification;
    private readonly JavaScriptSerializer json = new JavaScriptSerializer();
    private readonly uint activateMessage;
    private readonly bool settingsView;
    private readonly IntPtr ownerHandle;
    private PanelDock dock;
    private bool dockPreference;
    private int dockWidth;
    private bool resizingDock;
    private bool ready;
    private const int Frame = 4;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll")]
    private static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")]
    private static extern bool EnableWindow(IntPtr hwnd, bool enabled);
    [DllImport("user32.dll")]
    private static extern bool IsWindowEnabled(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr GetWindowDpiAwarenessContext(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
    [DllImport("user32.dll", CharSet = CharSet.Unicode, EntryPoint="GetPropW")]
    private static extern IntPtr GetProp(IntPtr hwnd, string name);
    [DllImport("user32.dll", EntryPoint = "GetWindowLongW")]
    private static extern int GetWindowStyle(IntPtr hwnd, int index);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)]
    private static extern int SetCurrentProcessExplicitAppUserModelID(string id);
    [DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attr, ref int value, int size);

    [STAThread]
    private static void Main(string[] args)
    {
        if (args.Length < 2) return;
        Uri url;
        if (!Uri.TryCreate(args[0], UriKind.Absolute, out url) || url.Scheme != "http"
            || url.Host != "127.0.0.1" || url.AbsolutePath != "/" || url.UserInfo != "") return;
        string profile = Path.GetFullPath(args[1]);
        bool settings = Array.Exists(url.Query.TrimStart('?').Split('&'), part => part == "view=settings");
        IntPtr owner = IntPtr.Zero;
        int ownerPid;
        if (args.Length > 4 && int.TryParse(args[4], out ownerPid))
        {
            owner = PobHandle(ownerPid);
        }
        Directory.CreateDirectory(profile);
        string identity;
        using (var hash = SHA256.Create())
            identity = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(profile.ToLowerInvariant() + (settings ? "|settings" : "")))).Replace("-", "").Substring(0, 20);
        using (var single = new PanelInstance(identity))
        {
            if (!single.IsOwner)
            {
                var pane = owner != IntPtr.Zero ? GetProp(owner, PanelDock.PaneProperty) : IntPtr.Zero;
                if (!settings && pane != IntPtr.Zero) PostMessage(pane, PanelDock.FocusMessage, IntPtr.Zero, IntPtr.Zero);
                PostMessage(new IntPtr(0xffff), RegisterWindowMessage("PoBAI.Panel.Activate." + identity), IntPtr.Zero, IntPtr.Zero);
                return;
            }
            SetCurrentProcessExplicitAppUserModelID("PoBAI.AgentPanel");
            // Every HWND, including WebView2, must be born in the same context as the parent.
            if (owner != IntPtr.Zero) SetThreadDpiAwarenessContext(GetWindowDpiAwarenessContext(owner));
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            string snapshot = args.Length > 2 && args[2] != "" ? args[2] : null;
            string verify = args.Length > 3 && args[3] != "" ? args[3] : null;
            using (var window = new AgentWindow(url, profile, identity, snapshot, verify, settings, owner))
            {
                if (settings && owner != IntPtr.Zero)
                {
                    bool enabled = IsWindowEnabled(owner);
                    try
                    {
                        if (enabled) EnableWindow(owner, false);
                        window.ShowDialog(new WindowOwner(owner));
                    }
                    finally { if (enabled) { EnableWindow(owner, true); SetForegroundWindow(owner); } }
                }
                else Application.Run(window);
            }
        }
    }

    private AgentWindow(Uri url, string profile, string identity, string snapshot, string verification, bool settings, IntPtr owner)
    {
        this.origin = url;
        this.profile = profile;
        this.snapshot = snapshot;
        this.verification = verification;
        this.settingsView = settings;
        this.ownerHandle = owner;
        this.activateMessage = RegisterWindowMessage("PoBAI.Panel.Activate." + identity);
        Text = settings ? "PoB AI Settings" : "PoB AI";
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = settings ? new Size(640, 720) : new Size(460, 900);
        MinimumSize = new Size(settings ? 430 : 370, 500);
        StartPosition = settings && owner != IntPtr.Zero ? FormStartPosition.CenterParent : FormStartPosition.CenterScreen;
        ShowInTaskbar = !settings || owner == IntPtr.Zero;
        FormBorderStyle = FormBorderStyle.None;
        Padding = new Padding(Frame);
        BackColor = Color.FromArgb(23, 27, 35);
        web.Dock = DockStyle.Fill;
        web.DefaultBackgroundColor = BackColor;
        web.AllowExternalDrop = false;
        Controls.Add(web);
        ReadPlacement();
        if (!settings)
        {
            dock = new PanelDock(this, SendState);
            if (dockWidth > 0) dock.Width = dockWidth;
            dock.SetTarget(owner);
            dock.SetEnabled(dockPreference);
        }
    }

    private static IntPtr PobHandle(int pid)
    {
        if (pid <= 0) return IntPtr.Zero;
        try
        {
            using (var process = Process.GetProcessById(pid))
                return process.ProcessName == "Path of Building-PoE2" ? process.MainWindowHandle : IntPtr.Zero;
        }
        catch (ArgumentException) { return IntPtr.Zero; }
        catch (InvalidOperationException) { return IntPtr.Zero; }
        catch (System.ComponentModel.Win32Exception) { return IntPtr.Zero; }
    }

    protected override CreateParams CreateParams
    {
        get
        {
            var cp = base.CreateParams;
            // Keep native resizing, Snap and the system menu, with no Windows caption.
            cp.Style = (cp.Style & ~(0x00c00000 | 0x00010000 | 0x00020000)) | 0x00040000 | 0x00080000;
            if (!settingsView) cp.Style |= 0x00010000 | 0x00020000;
            return cp;
        }
    }

    protected override async void OnShown(EventArgs e)
    {
        base.OnShown(e);
        try
        {
            var environment = await CoreWebView2Environment.CreateAsync(null, profile);
            await web.EnsureCoreWebView2Async(environment);
            var core = web.CoreWebView2;
            core.Settings.AreHostObjectsAllowed = false;
            core.Settings.AreDevToolsEnabled = false;
            core.Settings.IsStatusBarEnabled = false;
            core.Settings.IsNonClientRegionSupportEnabled = true;
            core.NavigationStarting += (s, n) => {
                if (!Trusted(n.Uri)) { n.Cancel = true; if (n.IsUserInitiated) OpenLink(n.Uri); }
            };
            core.FrameNavigationStarting += (s, n) => { if (!Trusted(n.Uri)) n.Cancel = true; };
            core.NewWindowRequested += (s, n) => { n.Handled = true; if (n.IsUserInitiated) OpenLink(n.Uri); };
            core.PermissionRequested += (s, n) => { n.State = CoreWebView2PermissionState.Deny; };
            core.WebMessageReceived += (s, message) => {
                if (!Trusted(message.Source)) return;
                try { ApplyMessage(message.TryGetWebMessageAsString()); } catch (ArgumentException) { }
            };
            core.NavigationCompleted += async (s, n) => {
                if (!n.IsSuccess) return;
                ready = true;
                SendState();
                if (snapshot != null) await CaptureVerification();
            };
            core.Navigate(origin.AbsoluteUri);
            ThemeFrame();
        }
        catch (Exception error)
        {
            Directory.CreateDirectory(Path.Combine(profile, "logs"));
            File.AppendAllText(Path.Combine(profile, "logs", "host.log"), DateTime.UtcNow.ToString("o") + " " + error + Environment.NewLine);
            if (verification != null) { File.WriteAllText(verification, json.Serialize(new { error = error.Message })); Close(); }
            else
            {
                // The familiar Edge app remains available if WebView2 is unavailable.
                var fallback = origin.AbsoluteUri;
                var edge = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), @"Microsoft\Edge\Application\msedge.exe");
                if (File.Exists(edge))
                {
                    string browserProfile = Path.Combine(Directory.GetParent(profile).FullName, "panel-profile");
                    Process.Start(new ProcessStartInfo(edge, "--app=\"" + fallback + "\" --window-size=460,900 --user-data-dir=\"" + browserProfile + "\"") { UseShellExecute = false });
                }
                Close();
            }
        }
    }

    private bool Trusted(string value)
    {
        Uri uri;
        return Uri.TryCreate(value, UriKind.Absolute, out uri) && uri.Scheme == origin.Scheme
            && uri.Host == origin.Host && uri.Port == origin.Port && uri.AbsolutePath == "/";
    }

    private static void OpenLink(string value)
    {
        Uri uri;
        if (Uri.TryCreate(value, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http"))
            Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
    }

    private void ApplyMessage(string message)
    {
        int pid;
        if (dock != null && message != null && message.StartsWith("pob:") && int.TryParse(message.Substring(4), out pid))
        {
            dock.SetTarget(PobHandle(pid));
            SendState();
            return;
        }
        int rgb;
        if (message != null && message.StartsWith("theme:#") && message.Length == 13
            && int.TryParse(message.Substring(7), NumberStyles.HexNumber, CultureInfo.InvariantCulture, out rgb))
        {
            BackColor = Color.FromArgb((rgb >> 16) & 255, (rgb >> 8) & 255, rgb & 255);
            ThemeFrame();
            return;
        }
        switch (message)
        {
            case "window:dock":
                if (dock != null) { dock.SetEnabled(!dock.Enabled); SavePlacement(); }
                break;
            case "service:reconnect":
                string launcher = Path.GetFullPath(Path.Combine(AppDomain.CurrentDomain.BaseDirectory, @"..\..\PoB AI.exe"));
                if (File.Exists(launcher)) Process.Start(new ProcessStartInfo(launcher, "--panel-only") { UseShellExecute = false });
                break;
            case "window:minimize": WindowState = FormWindowState.Minimized; break;
            case "window:maximize":
                if (dock != null && dock.Enabled) { dock.SetEnabled(false); SavePlacement(); }
                MaximizedBounds = Screen.FromHandle(Handle).WorkingArea;
                WindowState = WindowState == FormWindowState.Maximized ? FormWindowState.Normal : FormWindowState.Maximized;
                break;
            // Let the WebView2 event finish before disposing its COM controller.
            case "window:close": BeginInvoke(new Action(Close)); break;
        }
    }

    private void ThemeFrame()
    {
        int dark = BackColor.GetBrightness() > .5 ? 0 : 1, rounded = dock != null && dock.Attached ? 1 : 2;
        DwmSetWindowAttribute(Handle, 20, ref dark, 4);
        DwmSetWindowAttribute(Handle, 33, ref rounded, 4);
    }

    private void SendState()
    {
        if (IsHandleCreated) ThemeFrame();
        if (ready && !IsDisposed)
            web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new {
                kind = "window-state", maximized = WindowState == FormWindowState.Maximized,
                docked = dock != null && dock.Enabled, attached = dock != null && dock.Attached
            }));
    }

    protected override void OnResize(EventArgs e)
    {
        base.OnResize(e);
        SendState();
    }

    protected override void OnActivated(EventArgs e)
    {
        base.OnActivated(e);
        if (dock != null) dock.ActivateOwner();
        if (ready && !IsDisposed) web.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind = "window-activated" }));
    }

    protected override void WndProc(ref Message m)
    {
        if (dock != null && m.Msg == PanelDock.ReleaseMessage) { dock.ReleaseTarget(); return; }
        if (dock != null && m.Msg == PanelDock.FocusMessage)
        {
            dock.ActivateOwner(); web.Focus(); return;
        }
        if (m.Msg == activateMessage && activateMessage != 0)
        {
            if (dock != null) dock.ActivateOwner();
            if (WindowState == FormWindowState.Minimized) WindowState = FormWindowState.Normal;
            Show();
            if (dock == null || !dock.Attached) SetForegroundWindow(Handle);
            web.Focus();
            return;
        }
        if (dock != null && dock.Attached && m.Msg == 0x84) { m.Result = new IntPtr(1); return; }
        if (m.Msg == 0x83) { m.Result = IntPtr.Zero; return; } // WM_NCCALCSIZE: all client area
        if (m.Msg == 0x84 && WindowState == FormWindowState.Normal) // WM_NCHITTEST, outside WebView's 4px gutter
        {
            long p = m.LParam.ToInt64();
            Point at = PointToClient(new Point((short)(p & 0xffff), (short)((p >> 16) & 0xffff)));
            bool left = at.X < Frame, right = at.X >= ClientSize.Width - Frame;
            bool top = at.Y < Frame, bottom = at.Y >= ClientSize.Height - Frame;
            int hit = top ? (left ? 13 : right ? 14 : 12) : bottom ? (left ? 16 : right ? 17 : 15) : left ? 10 : right ? 11 : 0;
            if (hit != 0) { m.Result = new IntPtr(hit); return; }
        }
        base.WndProc(ref m);
    }

    private void ReadPlacement()
    {
        try
        {
            var saved = json.Deserialize<Placement>(File.ReadAllText(Path.Combine(profile, settingsView ? "settings-window.json" : "window.json")));
            dockPreference = saved.Docked;
            dockWidth = saved.DockWidth;
            var rect = new Rectangle(saved.X, saved.Y, Math.Max(settingsView ? 430 : 370, saved.Width), Math.Max(500, saved.Height));
            foreach (var screen in Screen.AllScreens)
                if (Rectangle.Intersect(screen.WorkingArea, rect).Width >= 100 && Rectangle.Intersect(screen.WorkingArea, rect).Height >= 100)
                { StartPosition = FormStartPosition.Manual; Bounds = rect; break; }
        }
        catch (Exception) { }
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        SavePlacement();
        if (dock != null) dock.Dispose();
        web.Dispose();
        base.OnFormClosed(e);
    }

    private void SavePlacement()
    {
        var bounds = dock != null ? dock.FloatingBounds : WindowState == FormWindowState.Normal ? Bounds : RestoreBounds;
        try
        {
            File.WriteAllText(Path.Combine(profile, settingsView ? "settings-window.json" : "window.json"), json.Serialize(new Placement {
                X = bounds.X, Y = bounds.Y, Width = bounds.Width, Height = bounds.Height, Docked = dock != null && dock.Enabled,
                DockWidth = dock != null ? dock.Width : 0
            }));
        }
        catch (IOException) { }
        catch (UnauthorizedAccessException) { }
    }

    protected override void OnFormClosing(FormClosingEventArgs e)
    {
        ready = false;
        base.OnFormClosing(e);
    }

    protected override void OnMouseDown(MouseEventArgs e)
    {
        if (dock != null && dock.Attached && e.Button == MouseButtons.Left && e.X < Frame)
        { resizingDock = true; Capture = true; }
        base.OnMouseDown(e);
    }
    protected override void OnMouseMove(MouseEventArgs e)
    {
        if (dock != null && dock.Attached)
        {
            Cursor = resizingDock || e.X < Frame ? Cursors.SizeWE : Cursors.Default;
            if (resizingDock) dock.ResizeFromScreenX(PointToScreen(e.Location).X);
        }
        base.OnMouseMove(e);
    }
    protected override void OnMouseUp(MouseEventArgs e)
    {
        if (resizingDock) { resizingDock = false; Capture = false; SavePlacement(); }
        base.OnMouseUp(e);
    }

    private async Task CaptureVerification()
    {
        await Task.Delay(2500);
        if (IsDisposed) return;
        if (verification != null)
        {
            bool dockInitial = dock != null && dock.Enabled, dockToggled = false, dockRestored = false;
            if (dock != null)
            {
                await web.CoreWebView2.ExecuteScriptAsync("document.getElementById('window-dock').click()");
                await Task.Delay(150);
                dockToggled = dock.Enabled != dockInitial;
                await web.CoreWebView2.ExecuteScriptAsync("document.getElementById('window-dock').click()");
                await Task.Delay(150);
                dockRestored = dock.Enabled == dockInitial;
            }
            if (!settingsView) ApplyMessage("window:maximize");
            bool maximized = WindowState == FormWindowState.Maximized;
            if (!settingsView) ApplyMessage("window:maximize");
            if (!settingsView) ApplyMessage("window:minimize");
            bool minimized = WindowState == FormWindowState.Minimized;
            WindowState = FormWindowState.Normal;
            if (dock != null) dock.SetEnabled(dockInitial);
            await Task.Delay(250);
            string dom = await web.CoreWebView2.ExecuteScriptAsync(
                "JSON.stringify({host:document.documentElement.dataset.host,view:document.documentElement.dataset.view,theme:document.documentElement.dataset.theme,background:getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(),logo:document.querySelector('.agent-brand img').getAttribute('src'),controls:[...document.querySelectorAll('.window-controls button')].filter(b=>b.getBoundingClientRect().width>0).length,dockChecked:document.getElementById('window-dock').getAttribute('aria-checked'),dockVisible:document.getElementById('window-dock').getBoundingClientRect().width>0,settings:!!document.getElementById('settings-dialog'),chatVisible:document.getElementById('chat').getBoundingClientRect().height>0,drag:getComputedStyle(document.querySelector('.agent-brand')).getPropertyValue('app-region'),overflow:document.documentElement.scrollWidth>innerWidth})");
            var originalSize = ClientSize;
            ClientSize = new Size(settingsView ? 430 : 370, 620);
            await Task.Delay(150);
            string compact = await web.CoreWebView2.ExecuteScriptAsync("document.documentElement.scrollWidth > innerWidth");
            ClientSize = originalSize;
            await Task.Delay(150);
            File.WriteAllText(verification, json.Serialize(new {
                maximized, minimized, dom, title = Text, compactOverflow = compact, settingsView, frameColor = ColorTranslator.ToHtml(BackColor),
                dockInitial, dockToggled, dockRestored,
                ownerDisabled = ownerHandle != IntPtr.Zero && !IsWindowEnabled(ownerHandle),
                nativeCaptionHidden = (GetWindowStyle(Handle, -16) & 0x00c00000) == 0,
                clientWidth = ClientSize.Width, clientHeight = ClientSize.Height, outerWidth = Width, outerHeight = Height
            }));
        }
        using (var stream = File.Create(snapshot))
            await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream);
        if (verification != null) BeginInvoke(new Action(Close));
    }

    private sealed class Placement { public int X, Y, Width, Height, DockWidth; public bool Docked; }
    private sealed class WindowOwner : IWin32Window
    {
        public IntPtr Handle { get; private set; }
        public WindowOwner(IntPtr handle) { Handle = handle; }
    }
}
